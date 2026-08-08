"""Minimal Google Gemini (AI Studio) client for the Placement Cell.

Uses only the Python stdlib (urllib) so no extra HTTP dependency is needed.
The API key comes from the GEMINI_API_KEY / GOOGLE_API_KEY env var (set in
backend/.env locally, and in the Render environment in production) - never
commit the key itself.
"""

import json
import os
import time
import urllib.error
import urllib.request

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
FALLBACK_MODELS = ["gemini-2.0-flash"]
# Transient 429s (burst rate limits) get one retry with backoff. A hard
# account-quota 429 still surfaces as an AiError with a clear message - we
# don't burn latency retrying when the quota is simply exhausted.
_429_RETRIES = int(os.environ.get("GEMINI_429_RETRIES", "1"))
_429_BACKOFF_SECONDS = float(os.environ.get("GEMINI_429_BACKOFF", "1.5"))

# Usage callback signature: (prompt_tokens: int, completion_tokens: int) -> None
UsageCallback = "callable[[int, int], None]"


class AiError(Exception):
    """Raised when the AI service is unavailable or returns a bad result."""


def get_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or ""
    if not key:
        raise AiError(
            "The Gemini API key is not configured. Ask the admin to set "
            "GEMINI_API_KEY in the server environment."
        )
    return key


def _call_model(parts_text: str, generation_config: dict | None = None,
                usage_callback=None) -> str:
    """POST to generateContent and return the raw text answer.

    usage_callback(prompt_tokens, completion_tokens) fires once when the
    response includes usage metadata (used to track per-user AI credits).
    """
    body = {
        "contents": [{"parts": [{"text": parts_text}]}],
        "generationConfig": generation_config or {},
    }
    data = json.dumps(body).encode("utf-8")
    models = [DEFAULT_MODEL, *FALLBACK_MODELS]

    for model in models:
        url = f"{BASE_URL}/models/{model}:generateContent"
        for attempt in range(_429_RETRIES + 1):
            req = urllib.request.Request(
                url,
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": get_api_key(),
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=45) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                if exc.code == 404 and model is not models[-1]:
                    break  # model not available - try the next one
                detail = exc.read().decode("utf-8", errors="replace")[:300]
                if exc.code == 429 and attempt < _429_RETRIES:
                    time.sleep(_429_BACKOFF_SECONDS * (attempt + 1))
                    continue
                raise AiError(f"Gemini API error ({exc.code}): {detail}") from exc
            except (urllib.error.URLError, TimeoutError) as exc:
                raise AiError(f"Could not reach the Gemini API: {exc}") from exc

            parts = payload.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            text = "".join(part.get("text", "") for part in parts).strip()
            if not text:
                reason = payload.get("promptFeedback", {}).get("blockReason", "empty response")
                raise AiError(f"The AI returned no answer ({reason}).")
            if usage_callback:
                meta = payload.get("usageMetadata") or {}
                usage_callback(
                    int(meta.get("promptTokenCount") or 0),
                    int(meta.get("candidatesTokenCount") or 0),
                )
            return text

    raise AiError("No available Gemini model found.")


def ai_json(system_prompt: str, user_text: str, max_tokens: int = 1024,
            usage_callback=None) -> dict:
    """Ask Gemini for a JSON object. Returns the parsed dict (never raises)."""
    config = {
        "responseMimeType": "application/json",
        "maxOutputTokens": max_tokens,
    }
    prompt = f"{system_prompt}\n\n---\n{user_text}"
    raw = _call_model(prompt, config, usage_callback=usage_callback)
    try:
        # Gemini sometimes wraps the JSON in a markdown fence - strip it.
        cleaned = raw.strip().removeprefix("```json").removesuffix("```").strip()
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def ai_plain_text(system_prompt: str, user_text: str, max_tokens: int = 1024,
                  usage_callback=None) -> str:
    """Ask Gemini for a plain-text answer (chat assistant)."""
    config = {"maxOutputTokens": max_tokens}
    return _call_model(
        f"{system_prompt}\n\n---\n{user_text}", config, usage_callback=usage_callback
    )
