"""Provider adapters for the AI Router.

Each adapter wraps one provider family behind a tiny common interface:

    generate(system_prompt, user_text, max_tokens, temperature,
             reasoning_budget, documents) -> (text, prompt_tokens, completion_tokens)

Every adapter decrypts its own API key at call time (never logged, never
serialized). Errors are raised as RouterError subclasses so the router can
decide whether to fail over or surface the problem.
"""

import json
import urllib.error
import urllib.request

from .ai_models import AIProvider

# OpenAI-compatible error statuses we should retry on a different provider.
_RECOVERABLE_STATUS = {429, 500, 502, 503, 504}


class RouterError(Exception):
    """Base error from a provider adapter call."""

    error_type = "PROVIDER_ERROR"

    def __init__(self, message: str = "", error_type: str | None = None):
        super().__init__(message)
        if error_type:
            self.error_type = error_type


class RecoverableProviderError(RouterError):
    """Provider is temporarily unavailable - safe to try the next provider."""


class AuthProviderError(RouterError):
    """Bad API key / config - retrying the same provider won't help."""


class TimeoutProviderError(RecoverableProviderError):
    error_type = "TIMEOUT"


class RateLimitedProviderError(RecoverableProviderError):
    error_type = "RATE_LIMITED"


class UnavailableProviderError(RecoverableProviderError):
    error_type = "UNAVAILABLE"


class EmptyResponseError(RecoverableProviderError):
    error_type = "EMPTY_RESPONSE"


def _status_code_from_error(exc) -> int:
    """Best-effort HTTP status from urllib/JSON decode errors."""
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code
    return 0


def _raise_for_status(exc, message: str) -> None:
    status = _status_code_from_error(exc)
    if status in (401, 403):
        raise AuthProviderError(message, error_type="AUTH") from exc
    if status == 429:
        raise RateLimitedProviderError(message, error_type="RATE_LIMITED") from exc
    if status in _RECOVERABLE_STATUS:
        raise UnavailableProviderError(message, error_type="HTTP_" + str(status)) from exc
    if isinstance(exc, (TimeoutError, urllib.error.URLError)) or "timed out" in str(exc).lower():
        raise TimeoutProviderError(message, error_type="TIMEOUT") from exc
    raise UnavailableProviderError(message, error_type="CONNECTION") from exc


class OpenAICompatAdapter:
    """Any OpenAI-compatible chat-completions API (NVIDIA, Groq, Cerebras,
    custom providers). Uses the ``openai`` SDK with the configured base URL."""

    def __init__(self, provider: AIProvider):
        self.provider = provider

    # -- used by the connection test ----------------------------------------
    def test(self, timeout: int) -> None:
        self.generate("Reply with exactly: OK", "Ping", max_tokens=8,
                      temperature=0, timeout=timeout)

    def generate(self, system_prompt, user_text, max_tokens, temperature=0.3,
                 reasoning_budget=0, documents=None, timeout=None,
                 api_key: str | None = None):
        from openai import (
            APIConnectionError,
            APIError,
            APITimeoutError,
            AuthenticationError,
            BadRequestError,
            OpenAI,
            RateLimitError,
        )

        from .ai_models import decrypt_secret

        key = api_key or decrypt_secret(self.provider.encrypted_api_key)
        if not key:
            raise AuthProviderError(
                "No API key configured for this provider.", error_type="NO_KEY"
            )
        base_url = self.provider.base_url or "https://api.openai.com/v1"
        client = OpenAI(
            base_url=base_url,
            api_key=key,
            timeout=timeout or self.provider.timeout_seconds or 60,
            max_retries=0,
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ]
        kwargs: dict = {
            "model": self.provider.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
        }
        extra: dict = {}
        if reasoning_budget and reasoning_budget > 0:
            extra["reasoning_budget"] = reasoning_budget
        if documents:
            # Some hosted RAG NIMs accept grounding documents; prompt-injection
            # below is the portable fallback so documents always work.
            extra["documents"] = [{"content": d} for d in documents]
        if extra:
            kwargs["extra_body"] = extra

        try:
            completion = client.chat.completions.create(**kwargs)
        except RateLimitError as exc:
            raise RateLimitedProviderError(
                "The AI service is busy (rate limit).", error_type="RATE_LIMITED"
            ) from exc
        except AuthenticationError as exc:
            raise AuthProviderError(
                "The API key is invalid or expired.", error_type="AUTH"
            ) from exc
        except APITimeoutError as exc:
            raise TimeoutProviderError(
                "The AI service took too long to respond.", error_type="TIMEOUT"
            ) from exc
        except APIConnectionError as exc:
            raise UnavailableProviderError(
                "Could not reach the AI service.", error_type="CONNECTION"
            ) from exc
        except BadRequestError as exc:
            detail = str(getattr(exc, "body", "") or exc).lower()
            if "reasoning" in detail and reasoning_budget:
                # Retry once without the reasoning budget.
                kwargs.pop("extra_body", None)
                try:
                    completion = client.chat.completions.create(**kwargs)
                except Exception as retry_exc:
                    raise UnavailableProviderError(
                        f"AI API error: {detail[:200]}", error_type="BAD_REQUEST"
                    ) from retry_exc
            else:
                raise UnavailableProviderError(
                    f"AI API error: {detail[:200]}", error_type="BAD_REQUEST"
                ) from exc
        except APIError as exc:
            raise UnavailableProviderError(
                f"AI API error: {str(exc)[:200]}", error_type="API_ERROR"
            ) from exc

        choices = completion.choices or []
        text = ""
        if choices:
            text = (choices[0].message.content or "").strip()
        if not text:
            raise EmptyResponseError(
                "The AI returned no answer.", error_type="EMPTY_RESPONSE"
            )
        usage = getattr(completion, "usage", None)
        prompt_tokens = int(usage.prompt_tokens or 0) if usage else 0
        completion_tokens = int(usage.completion_tokens or 0) if usage else 0
        return text, prompt_tokens, completion_tokens


class GeminiAdapter:
    """Google Gemini via the REST generateContent API.

    Uses only the standard library so no extra SDK dependency is needed. The
    model (e.g. gemini-2.0-flash) is configurable from the Admin Dashboard.
    """

    BASE = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(self, provider: AIProvider):
        self.provider = provider

    def test(self, timeout: int) -> None:
        self.generate("Reply with exactly: OK", "Ping", max_tokens=8,
                      temperature=0, timeout=timeout)

    def generate(self, system_prompt, user_text, max_tokens, temperature=0.3,
                 reasoning_budget=0, documents=None, timeout=None,
                 api_key: str | None = None):
        from .ai_models import decrypt_secret

        key = api_key or decrypt_secret(self.provider.encrypted_api_key)
        if not key:
            raise AuthProviderError(
                "No API key configured for this provider.", error_type="NO_KEY"
            )
        model = self.provider.model or "gemini-2.0-flash"
        contents = [{"parts": [{"text": user_text}]}]
        if documents:
            parts = [{"text": d} for d in documents]
            contents.insert(0, {"role": "user", "parts": parts})
        payload = {
            "contents": contents,
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": temperature,
            },
        }
        url = f"{self.BASE}/models/{model}:generateContent?key={key}"
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.provider.timeout_seconds or 60) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read().decode("utf-8")[:200]
            except Exception:
                pass
            _raise_for_status(exc, f"Gemini API error: {detail}")
        except Exception as exc:
            _raise_for_status(exc, "Could not reach the Gemini API.")

        candidates = body.get("candidates") or []
        text = ""
        if candidates:
            parts = candidates[0].get("content", {}).get("parts") or []
            text = "".join(p.get("text", "") for p in parts if isinstance(p, dict)).strip()
        if not text:
            raise EmptyResponseError(
                "Gemini returned no answer.", error_type="EMPTY_RESPONSE"
            )
        usage = body.get("usageMetadata") or {}
        prompt_tokens = int(usage.get("promptTokenCount") or 0)
        completion_tokens = int(usage.get("candidatesTokenCount") or 0)
        return text, prompt_tokens, completion_tokens


def adapter_for(provider: AIProvider):
    """Return the right adapter for a provider row."""
    if provider.provider_type == AIProvider.ProviderType.GEMINI:
        return GeminiAdapter(provider)
    return OpenAICompatAdapter(provider)
