"""NVIDIA client (OpenAI-compatible) for the Placement Cell.

Uses the official ``openai`` SDK pointed at NVIDIA's OpenAI-compatible
endpoint (https://integrate.api.nvidia.com/v1). Two services are supported:

* **Generation (default)** - the 30B model ``nvidia/nemotron-3-nano-30b-a3b``
  (configurable via ``NVIDIA_MODEL``) used for drive-text extraction, chat,
  resume quality review and drive matching. A comma-separated
  ``NVIDIA_FALLBACK_MODELS`` list is tried when the primary model is down.

* **RAG** - NVIDIA's hosted RAG NIM (configurable via ``NVIDIA_RAG_MODEL``,
  default ``nvidia/nim-rag``) which accepts the documents to ground answers
  on via the ``documents`` request field. When a call passes ``documents=``
  AND a separate ``NVIDIA_RAG_API_KEY`` is configured, the RAG service is
  used; otherwise - or whenever the RAG service fails - the same documents
  are injected straight into the prompt of the regular 30B model, so answers
  stay grounded in the provided documents either way.

API keys are read ONLY from environment variables (backend/.env locally, the
Render environment in production) - they are never hardcoded, logged, returned
in API responses or exposed to the browser.
"""

import json
import logging
import os
import time

from openai import (
    APIConnectionError,
    APIError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    OpenAI,
    RateLimitError,
)

logger = logging.getLogger(__name__)

BASE_URL = os.environ.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")
DEFAULT_MODEL = os.environ.get("NVIDIA_MODEL", "nvidia/nemotron-3-nano-30b-a3b")
FALLBACK_MODELS = [
    m.strip()
    for m in os.environ.get(
        "NVIDIA_FALLBACK_MODELS", "meta/llama-3.3-70b-instruct"
    ).split(",")
    if m.strip()
]
# The hosted RAG NIM used for document-grounded answers when a separate RAG key
# is configured. Set NVIDIA_RAG_MODEL to the exact model id from your NVIDIA
# catalog (e.g. nvidia/nim-rag) if yours differs.
RAG_MODEL = os.environ.get("NVIDIA_RAG_MODEL", "nvidia/nim-rag")
# Transient 429s (burst rate limits) get a couple of retries with backoff. A
# hard account-quota 429 still surfaces as an AiError with a clear message -
# we don't burn latency retrying when the quota is simply exhausted.
_429_RETRIES = int(os.environ.get("NVIDIA_429_RETRIES", "2"))
_429_BACKOFF_SECONDS = float(os.environ.get("NVIDIA_429_BACKOFF", "1.5"))
_TIMEOUT_SECONDS = float(os.environ.get("NVIDIA_TIMEOUT", "60"))

# Reasoning budgets (extra_body={"reasoning_budget": N}) per endpoint. These
# are deliberately modest - not the 16k sample default - so simple extraction
# and chat stay fast and cheap. Set to 0 to disable reasoning.
REASONING_BUDGETS = {
    "extract": int(os.environ.get("NVIDIA_REASONING_EXTRACT", "4096")),
    "chat": int(os.environ.get("NVIDIA_REASONING_CHAT", "2048")),
}

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


def _chat_completion_inner(
    system_prompt: str,
    user_text: str,
    max_tokens: int,
    usage_callback=None,
    reasoning_budget: int = 0,
    temperature: float = 0.3,
    documents: list | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> str:
    """One raw chat-completion call through the OpenAI SDK.

    ``documents`` (a list of dicts, e.g. [{"content": "..."}]) is sent to the
    RAG NIM as grounding. ``model``/``api_key`` override the defaults (used by
    the RAG path); otherwise the standard model + NVIDIA_API_KEY are used.
    """
    client = OpenAI(
        base_url=BASE_URL,
        api_key=api_key or get_api_key(),
        timeout=_TIMEOUT_SECONDS,
        # Don't let the SDK silently retry on top of our own 429/connection
        # retry loop (its default is 2) - one retry here keeps behavior
        # predictable and matches the NVIDIA_429_RETRIES setting.
        max_retries=1,
    )
    base_kwargs: dict = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
        "top_p": 0.9,
        "stream": False,
    }

    models = [model] if model else [DEFAULT_MODEL, *FALLBACK_MODELS]
    last_error = "unknown error"
    for candidate in models:
        kwargs = dict(base_kwargs, model=candidate)
        extra: dict = {}
        if reasoning_budget > 0:
            extra["reasoning_budget"] = reasoning_budget
        if documents:
            extra["documents"] = documents
        if extra:
            kwargs["extra_body"] = extra
        for attempt in range(_429_RETRIES + 1):
            try:
                completion = client.chat.completions.create(**kwargs)
            except RateLimitError:
                last_error = "the AI service is busy (rate limit) - try again in a moment"
                if attempt < _429_RETRIES:
                    time.sleep(_429_BACKOFF_SECONDS * (attempt + 1))
                    continue
                break
            except AuthenticationError as exc:
                raise AiError(
                    "The AI API key is invalid or expired. Ask the admin to "
                    "check the NVIDIA API keys on the server."
                ) from exc
            except APITimeoutError as exc:
                raise AiError(
                    "The AI service took too long to respond. Try again in a moment."
                ) from exc
            except APIConnectionError as exc:
                raise AiError(f"Could not reach the AI service: {exc}") from exc
            except BadRequestError as exc:
                detail = str(getattr(exc, "body", "") or exc).lower()
                # A model may not accept a reasoning budget - retry lean,
                # keeping any grounding documents intact.
                if "reasoning" in detail and reasoning_budget > 0:
                    reasoning_budget = 0
                    extra.pop("reasoning_budget", None)
                    if extra:
                        kwargs["extra_body"] = extra
                    else:
                        kwargs.pop("extra_body", None)
                    continue
                # The model doesn't accept grounding documents (not a RAG NIM)
                # - surface it so the caller falls back to prompt injection.
                if "document" in detail and documents:
                    raise AiError(f"AI API error: {detail[:300]}") from exc
                # A model that doesn't exist - fall through to the next one.
                if "model" in detail and candidate is not models[-1]:
                    break
                raise AiError(f"AI API error: {detail[:300]}") from exc
            except APIError as exc:
                raise AiError(f"AI API error: {str(exc)[:300]}") from exc

            choices = completion.choices or []
            text = ""
            if choices:
                text = (choices[0].message.content or "").strip()
            if not text:
                raise AiError("The AI returned no answer (empty response).")
            if usage_callback and getattr(completion, "usage", None):
                usage_callback(
                    int(completion.usage.prompt_tokens or 0),
                    int(completion.usage.completion_tokens or 0),
                )
            return text

    raise AiError(
        f"The AI service could not complete the request. Last error: {last_error}"
    )


def _chat_completion(
    system_prompt: str,
    user_text: str,
    max_tokens: int,
    usage_callback=None,
    reasoning_budget: int = 0,
    temperature: float = 0.3,
    documents: list[str] | None = None,
) -> str:
    """Call the AI and return the answer text (RAG-aware).

    When ``documents`` (plain strings) are provided AND a separate
    ``NVIDIA_RAG_API_KEY`` is configured, the hosted RAG NIM grounds the answer
    on those documents. If the RAG service is unavailable or misconfigured, the
    same documents are injected into the prompt of the regular 30B model, so
    the answer is always grounded in the provided material.
    """
    rag_key = os.environ.get("NVIDIA_RAG_API_KEY") if documents else None
    if rag_key:
        try:
            return _chat_completion_inner(
                system_prompt,
                user_text,
                max_tokens,
                usage_callback=usage_callback,
                reasoning_budget=reasoning_budget,
                temperature=temperature,
                documents=[{"content": d} for d in documents],
                model=RAG_MODEL,
                api_key=rag_key,
            )
        except AiError as exc:
            # Never fail the request - answer is still grounded via prompt
            # injection. The warning lets an admin spot a wrong RAG key or
            # model id (e.g. NVIDIA_RAG_MODEL doesn't match the catalog).
            logger.warning(
                "RAG NIM unavailable (%s) - falling back to 30B context injection",
                exc,
            )

    grounded_prompt = system_prompt
    if documents:
        grounded_prompt = (
            system_prompt
            + "\n\nDOCUMENTS (answer using ONLY these):\n\n"
            + "\n\n---\n\n".join(documents)
        )
    return _chat_completion_inner(
        grounded_prompt,
        user_text,
        max_tokens,
        usage_callback=usage_callback,
        reasoning_budget=reasoning_budget,
        temperature=temperature,
    )


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
    reasoning_budget: int = 0,
    documents: list[str] | None = None,
) -> dict:
    """Ask the AI for a JSON object. Returns the parsed dict (never raises).

    ``documents`` (optional) grounds the answer on the given material via the
    RAG service (or prompt injection when RAG is not configured).
    """
    raw = _chat_completion(
        system_prompt,
        user_text,
        max_tokens,
        usage_callback=usage_callback,
        reasoning_budget=reasoning_budget,
        temperature=0.3,
        documents=documents,
    )
    return _extract_json_object(raw)


def ai_plain_text(
    system_prompt: str,
    user_text: str,
    max_tokens: int = 1024,
    usage_callback=None,
    reasoning_budget: int = 0,
    documents: list[str] | None = None,
) -> str:
    """Ask the AI for a plain-text answer (chat assistant).

    ``documents`` (optional) grounds the answer on the given material via the
    RAG service (or prompt injection when RAG is not configured).
    """
    return _chat_completion(
        system_prompt,
        user_text,
        max_tokens,
        usage_callback=usage_callback,
        reasoning_budget=reasoning_budget,
        temperature=0.7,
        documents=documents,
    )
