"""Minimal NVIDIA NIM (OpenAI-compatible) client for the Placement Cell.

Uses only the Python stdlib (urllib) so no extra HTTP dependency is needed.
The API key comes from the NVIDIA_API_KEY env var (set in backend/.env
locally, and in the Render environment in production) - never commit the key
itself.

The request format follows the NVIDIA chat-completions API (the same shape as
the OpenAI API): POST https://integrate.api.nvidia.com/v1/chat/completions
"""

import json
import os
import time
import urllib.error
import urllib.request

BASE_URL = os.environ.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")
DEFAULT_MODEL = os.environ.get(
    "NVIDIA_MODEL", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
)
FALLBACK_MODELS = [
    os.environ.get("NVIDIA_FALLBACK_MODEL", "meta/llama-3.3-70b-instruct")
]
# Transient 429s (burst rate limits) get one retry with backoff. A hard
# account-quota 429 still surfaces as an AiError with a clear message - we
# don't burn latency retrying when the quota is simply exhausted.
_429_RETRIES = int(os.environ.get("NVIDIA_429_RETRIES", "1"))
_429_BACKOFF_SECONDS = float(os.environ.get("NVIDIA_429_BACKOFF", "1.5"))
_TIMEOUT_SECONDS = 60

# Usage callback signature: (prompt_tokens: int, completion_tokens: int) -> None
UsageCallback = "callable[[int, int], None]"


class AiError(Exception):
    """Raised when the AI service is unavailable or returns a bad result."""


def get_api_key() -> str:
    key = os.environ.get("NVIDIA_API_KEY") or ""
    if not key:
        raise AiError(
            "The AI API key is not configured. Ask the admin to set "
            "NVIDIA_API_KEY in the server environment."
        )
    return key


def _chat_completion(
    system_prompt: str,
    user_text: str,
    max_tokens: int,
    usage_callback=None,
) -> str:
    """POST to the NVIDIA chat-completions endpoint and return the answer text.

    usage_callback(prompt_tokens, completion_tokens) fires once when the
    response includes a usage object (used to track per-user AI credits).
    """
    base_body = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
        "max_tokens": max_tokens,
        "stream": False,
        "temperature": 0.6,
        "top_p": 0.95,
    }
    models = [DEFAULT_MODEL, *FALLBACK_MODELS]
    url = f"{BASE_URL}/chat/completions"

    for model in models:
        body = dict(base_body, model=model)
        data = json.dumps(body).encode("utf-8")
        for attempt in range(_429_RETRIES + 1):
            req = urllib.request.Request(
                url,
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {get_api_key()}",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")[:300]
                if exc.code == 429 and attempt < _429_RETRIES:
                    time.sleep(_429_BACKOFF_SECONDS * (attempt + 1))
                    continue
                # A model that doesn't exist surfaces as 400/404 with "model"
                # in the error body - fall through to the next model instead
                # of failing the whole request.
                if (
                    exc.code in (400, 404)
                    and "model" in detail.lower()
                    and model is not models[-1]
                ):
                    break
                raise AiError(f"AI API error ({exc.code}): {detail}") from exc
            except (urllib.error.URLError, TimeoutError) as exc:
                raise AiError(f"Could not reach the AI API: {exc}") from exc

            choices = payload.get("choices") or []
            text = ""
            if choices:
                message = choices[0].get("message") or {}
                text = message.get("content") or choices[0].get("text") or ""
            text = str(text).strip()
            if not text:
                reason = payload.get("error") or "empty response"
                raise AiError(f"The AI returned no answer ({reason}).")
            if usage_callback:
                usage = payload.get("usage") or {}
                usage_callback(
                    int(usage.get("prompt_tokens") or 0),
                    int(usage.get("completion_tokens") or 0),
                )
            return text

    raise AiError("No available AI model found.")


def _extract_json_object(raw: str) -> dict:
    """Parse a JSON object from a model answer, tolerating markdown fences and
    surrounding prose (reasoning models sometimes wrap or annotate output)."""
    cleaned = raw.strip()
    cleaned = cleaned.removeprefix("```json").removeprefix("```")
    cleaned = cleaned.removesuffix("```").strip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    # Last resort: pull the first {...} block out of the text.
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end > start:
        try:
            parsed = json.loads(cleaned[start : end + 1])
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return {}


def ai_json(
    system_prompt: str,
    user_text: str,
    max_tokens: int = 1024,
    usage_callback=None,
) -> dict:
    """Ask the AI for a JSON object. Returns the parsed dict (never raises)."""
    raw = _chat_completion(
        system_prompt, user_text, max_tokens, usage_callback=usage_callback
    )
    return _extract_json_object(raw)


def ai_plain_text(
    system_prompt: str,
    user_text: str,
    max_tokens: int = 1024,
    usage_callback=None,
) -> str:
    """Ask the AI for a plain-text answer (chat assistant)."""
    return _chat_completion(
        system_prompt, user_text, max_tokens, usage_callback=usage_callback
    )
