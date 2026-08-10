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


def _data_uri_parts(uri: str) -> tuple[str, str]:
    """Split a ``data:image/png;base64,<b64>`` URI into (mime_type, b64)."""
    prefix, _, payload = uri.partition(",")
    mime = "image/png"
    if ";" in prefix and prefix.startswith("data:"):
        mime = prefix[len("data:") :].split(";", 1)[0] or "image/png"
    return mime, payload


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
                 api_key: str | None = None, images: list[str] | None = None,
                 raw_json: bool = False):
        from openai import (
            APIConnectionError,
            APIError,
            APITimeoutError,
            AuthenticationError,
            BadRequestError,
            OpenAI,
            RateLimitError,
        )

        from .ai_models import provider_key_chain

        # Try every key (primary, extra keys, then env keys) in order; a
        # rate-limited or invalid key simply moves on to the next one, so the
        # portal keeps working when one account hits its quota.
        keys = [api_key] if api_key else provider_key_chain(self.provider)
        if not keys:
            raise AuthProviderError(
                "No API key configured for this provider.", error_type="NO_KEY"
            )
        base_url = self.provider.base_url or "https://api.openai.com/v1"
        if images:
            # Multimodal request (vision models only): the user message becomes
            # text + image parts (base64 data URIs). A text-only model rejects
            # this with a 4xx which the router treats as a recoverable failure,
            # so it naturally falls over to a vision-capable provider.
            content: list[dict] = [{"type": "text", "text": user_text}]
            for uri in images:
                content.append({"type": "image_url", "image_url": {"url": uri}})
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content},
            ]
        else:
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
        if raw_json and not images:
            # Ask the provider for a structured JSON object. Providers that
            # don't support response_format reject it with a 4xx which the
            # retry below handles by falling back to a plain completion.
            kwargs["response_format"] = {"type": "json_object"}

        last_key_error: RouterError | None = None
        for key in keys:
            client = OpenAI(
                base_url=base_url,
                api_key=key,
                timeout=timeout or self.provider.timeout_seconds or 60,
                max_retries=0,
            )
            try:
                completion = client.chat.completions.create(**kwargs)
            except RateLimitError as exc:
                # This key hit its quota - remember it and try the next one.
                last_key_error = RateLimitedProviderError(
                    "The AI service is busy (rate limit).", error_type="RATE_LIMITED"
                )
                continue
            except AuthenticationError as exc:
                # This key is dead - try the next one before giving up.
                last_key_error = AuthProviderError(
                    "The API key is invalid or expired.", error_type="AUTH"
                )
                continue
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
                elif ("response_format" in detail or "json_object" in detail) \
                        and kwargs.get("response_format"):
                    # The provider/model doesn't support structured output -
                    # retry once as a plain completion (the prompt still asks
                    # for JSON and the parser tolerates loose output).
                    kwargs.pop("response_format", None)
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

        # Every key failed on a key-specific error (rate limit / auth). Surface
        # the last one so the router can fail over to the next provider.
        raise last_key_error or RouterError(
            "All API keys for this provider failed.", error_type="PROVIDER_ERROR"
        )


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
                 api_key: str | None = None, images: list[str] | None = None,
                 raw_json: bool = False):
        from .ai_models import provider_key_chain

        # Try every key (stored primary, extra keys, then GEMINI_API_KEY env
        # keys) in order - a rate-limited or invalid key rotates to the next.
        keys = [api_key] if api_key else provider_key_chain(self.provider)
        if not keys:
            raise AuthProviderError(
                "No API key configured for this provider.", error_type="NO_KEY"
            )
        model = self.provider.model or "gemini-2.0-flash"
        if images:
            # Gemini accepts base64 images as inline_data parts (vision model).
            parts: list[dict] = [{"text": user_text}]
            for uri in images:
                mime, b64 = _data_uri_parts(uri)
                parts.append({"inline_data": {"mime_type": mime, "data": b64}})
            contents = [{"parts": parts}]
        else:
            contents = [{"parts": [{"text": user_text}]}]
        if documents:
            parts = [{"text": d} for d in documents]
            contents.insert(0, {"role": "user", "parts": parts})
        generation_config = {
            "maxOutputTokens": max_tokens,
            "temperature": temperature,
        }
        if raw_json and not images:
            # Ask Gemini for a structured JSON response.
            generation_config["responseMimeType"] = "application/json"
        payload = {
            "contents": contents,
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "generationConfig": generation_config,
        }
        data = json.dumps(payload).encode("utf-8")

        def _post(url: str) -> dict:
            req = urllib.request.Request(
                url,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(
                req, timeout=timeout or self.provider.timeout_seconds or 60
            ) as resp:
                return json.loads(resp.read().decode("utf-8"))

        last_key_error: RouterError | None = None
        for key in keys:
            url = f"{self.BASE}/models/{model}:generateContent?key={key}"
            body = None
            retried_without_mime = False
            while True:
                try:
                    body = _post(url)
                    break
                except urllib.error.HTTPError as exc:
                    detail = ""
                    try:
                        detail = exc.read().decode("utf-8")[:200]
                    except Exception:
                        pass
                    if exc.code == 429:
                        # Quota exhausted for this key - try the next one.
                        last_key_error = RateLimitedProviderError(
                            f"Gemini API error: {detail}", error_type="RATE_LIMITED"
                        )
                        break
                    if exc.code in (401, 403):
                        # This key is invalid - try the next one before giving up.
                        last_key_error = AuthProviderError(
                            f"Gemini API error: {detail}", error_type="AUTH"
                        )
                        break
                    if (
                        raw_json
                        and not retried_without_mime
                        and "responseMimeType" in generation_config
                        and ("mime" in detail.lower()
                             or "response_mime_type" in detail.lower())
                    ):
                        # The model doesn't support structured JSON output -
                        # retry once as a plain completion (the prompt still
                        # asks for JSON and the parser tolerates loose output).
                        generation_config.pop("responseMimeType", None)
                        payload["generationConfig"] = generation_config
                        data = json.dumps(payload).encode("utf-8")
                        retried_without_mime = True
                        continue
                    _raise_for_status(exc, f"Gemini API error: {detail}")
                except Exception as exc:
                    _raise_for_status(exc, "Could not reach the Gemini API.")
            if body is None:
                continue  # key-specific error - try the next key

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

        # Every key failed on a key-specific error (rate limit / auth).
        raise last_key_error or RouterError(
            "All API keys for this provider failed.", error_type="PROVIDER_ERROR"
        )


def adapter_for(provider: AIProvider):
    """Return the right adapter for a provider row."""
    if provider.provider_type == AIProvider.ProviderType.GEMINI:
        return GeminiAdapter(provider)
    return OpenAICompatAdapter(provider)
