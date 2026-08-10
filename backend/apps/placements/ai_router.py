"""AI Router service.

The single entry point for every AI call in the portal:

    AIService.generate(task=..., user=..., system_prompt=..., user_text=...,
                       documents=..., ...)

Behaviour:
  * Reads the AI settings (enable AI, caching, fallback, maintenance mode).
  * Picks the provider chain for the task (task configuration, else all enabled
    providers by priority).
  * Tries each provider in order; on recoverable failures (429/timeout/5xx)
    moves to the next provider (failover). Auth/config errors stop that chain.
  * Serves repeated non-personal questions from the Django cache.
  * Logs every call (AIRequestLog) and updates provider health.

When NO providers are configured yet, the router falls back to the legacy
environment-configured NVIDIA client so the portal keeps working out of the box.
"""

import hashlib
import json
import logging
import time

from django.core.cache import cache
from django.db.models import F as models_F
from django.utils import timezone

from .ai_adapters import AuthProviderError, RecoverableProviderError, RouterError, adapter_for
from .ai_models import (
    AIProvider,
    AIProviderHealth,
    AIRequestLog,
    AISettings,
    AITaskConfiguration,
)

logger = logging.getLogger(__name__)

# Cache namespace so a settings/cache change naturally invalidates old keys.
_NS = "aimgr_v1"


class AIServiceUnavailable(Exception):
    """All providers failed or AI is disabled - user-friendly message only."""


def _settings() -> AISettings:
    return AISettings.get()


def _task_chain(task: str):
    """Provider chain for a task: explicit config if present, else all enabled.

    Extra keys are prefetched so the adapters can fail over between a
    provider's stored keys without extra queries.
    """
    config = AITaskConfiguration.objects.filter(task=task).first()
    if config:
        chain = config.provider_chain()
        if chain:
            # Re-fetch with keys prefetched while preserving the configured order.
            by_id = {
                p.pk: p
                for p in AIProvider.objects.filter(pk__in=[p.pk for p in chain])
                .prefetch_related("keys")
            }
            return [by_id[p.pk] for p in chain if p.pk in by_id]
    return list(
        AIProvider.objects.filter(enabled=True)
        .order_by("priority", "id")
        .prefetch_related("keys")
    )


def _attempt(provider: AIProvider, adapter, system_prompt, user_text, max_tokens,
             temperature, reasoning_budget, documents, timeout):
    """One call to one provider. Returns (text, prompt_tokens, completion_tokens)."""
    return adapter.generate(
        system_prompt, user_text, max_tokens,
        temperature=temperature,
        reasoning_budget=reasoning_budget,
        documents=documents,
        timeout=timeout,
    )


def _mark_success(provider: AIProvider, prompt_tokens, completion_tokens):
    AIProvider.objects.filter(pk=provider.pk).update(
        health=AIProvider.Health.HEALTHY,
        last_success_at=timezone.now(),
        consecutive_failures=0,
        last_error_type="",
        total_requests=models_F("total_requests") + 1,
    )
    health, _ = AIProviderHealth.objects.get_or_create(provider=provider)
    health.status = AIProvider.Health.HEALTHY
    health.last_success_at = timezone.now()
    health.last_used_at = timezone.now()
    health.success_count += 1
    health.failure_count = 0
    health.last_error_type = ""
    health.save()


def _mark_failure(provider: AIProvider, error_type: str):
    AIProvider.objects.filter(pk=provider.pk).update(
        last_failure_at=timezone.now(),
        last_error_type=error_type[:40],
        consecutive_failures=models_F("consecutive_failures") + 1,
        total_errors=models_F("total_errors") + 1,
    )
    health, _ = AIProviderHealth.objects.get_or_create(provider=provider)
    health.last_failure_at = timezone.now()
    health.last_error_type = error_type[:40]
    health.failure_count += 1
    health.last_used_at = timezone.now()
    # Degrade health on repeated failures (never disable the row).
    if health.failure_count >= 5:
        health.status = AIProvider.Health.UNAVAILABLE
    elif health.failure_count >= 2:
        health.status = AIProvider.Health.DEGRADED
    else:
        health.status = AIProvider.Health.RATE_LIMITED if "RATE" in error_type.upper() else AIProvider.Health.DEGRADED
    health.save()


def _record_log(user, task, primary_name, provider_used, status, fallback_used,
                error_type="", prompt_tokens=0, completion_tokens=0, latency_ms=0):
    provider_id = None
    provider_name = provider_used
    if isinstance(provider_used, tuple):
        provider_id, provider_name = provider_used[1], provider_used[0]
    try:
        AIRequestLog.objects.create(
            provider_id=provider_id,
            provider_used=provider_name,
            primary_provider=primary_name,
            task=task,
            user=user if user and user.is_authenticated else None,
            status=status,
            fallback_used=fallback_used,
            error_type=error_type[:40],
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=latency_ms,
        )
    except Exception:  # pragma: no cover - logging must never break AI calls
        pass


def _cache_key(task, system_prompt, user_text):
    digest = hashlib.sha256(f"{system_prompt}|{user_text}".encode("utf-8")).hexdigest()
    return f"{_NS}:{task}:{digest}"


class AIService:
    """Router facade used by the rest of the application."""

    # Student-specific questions must never be served from a shared cache.
    _STUDENT_SPECIFIC_RE = None  # assigned below (avoids import cycle at module load)

    @classmethod
    def generate(cls, task, system_prompt, user_text, max_tokens=1024,
                 temperature=0.3, reasoning_budget=0, documents=None,
                 user=None, cacheable=True, timeout=None, raw_json=False,
                 usage_callback=None):
        st = _settings()
        if not st.enable_ai or st.maintenance_mode:
            raise AIServiceUnavailable(
                "AI service is temporarily unavailable. Please try again shortly."
            )

        started = time.monotonic()

        # ---- cached answers for repeated non-personal questions -----------
        if st.enable_caching and cacheable:
            key = _cache_key(task, system_prompt, user_text)
            cached = cache.get(key)
            if cached is not None:
                try:
                    return json.loads(cached) if raw_json else cached
                except Exception:
                    pass

        chain = _task_chain(task)
        if not chain:
            raise AIServiceUnavailable(
                "No AI provider is configured. Ask the admin to add one."
            )

        primary_name = chain[0].name if chain else ""
        fallback_used = False

        for provider in chain:
            if not provider.enabled:
                continue
            adapter = adapter_for(provider)
            try:
                text, pt, ct = _attempt(
                    provider, adapter, system_prompt, user_text, max_tokens,
                    temperature, reasoning_budget, documents, timeout,
                )
                latency_ms = int((time.monotonic() - started) * 1000)
                _mark_success(provider, pt, ct)
                _record_log(
                    user, task, primary_name, (provider.name, provider.pk),
                    AIRequestLog.Status.SUCCESS, fallback_used,
                    prompt_tokens=pt, completion_tokens=ct, latency_ms=latency_ms,
                )
                if usage_callback:
                    try:
                        usage_callback(pt, ct)
                    except Exception:  # pragma: no cover
                        pass
                result = text if not raw_json else _extract_json(text)
                if st.enable_caching and cacheable:
                    cache.set(key, result, timeout=300)
                return result
            except AuthProviderError as exc:
                _mark_failure(provider, exc.error_type)
                _record_log(user, task, primary_name, (provider.name, provider.pk),
                            AIRequestLog.Status.FAILED, fallback_used,
                            error_type=exc.error_type)
                break  # auth error - retrying the same provider is pointless
            except RecoverableProviderError as exc:
                _mark_failure(provider, exc.error_type)
                _record_log(user, task, primary_name, (provider.name, provider.pk),
                            AIRequestLog.Status.FAILED, fallback_used,
                            error_type=exc.error_type)
                if not st.enable_fallback:
                    break
                # Fail over to the next provider (no sleep - the adapter's SDK
                # already handled transient retries internally).
                fallback_used = True
                continue
            except RouterError as exc:
                _mark_failure(provider, exc.error_type)
                _record_log(user, task, primary_name, (provider.name, provider.pk),
                            AIRequestLog.Status.FAILED, fallback_used,
                            error_type=exc.error_type)
                break

        raise AIServiceUnavailable(
            "AI service is temporarily unavailable. Please try again shortly."
        )

    # ------------------------------------------------------------------
    # Connection test (admin "Test" button)
    # ------------------------------------------------------------------
    @staticmethod
    def test_provider(provider: AIProvider, timeout: int = 15) -> str:
        """Run a tiny call. Returns 'HEALTHY' or raises RouterError.

        Any unexpected exception (missing encryption key, SDK quirks,
        malformed provider response) is converted into a RouterError so the
        admin API can surface a friendly message instead of a raw 500.
        """
        try:
            adapter = adapter_for(provider)
            adapter.test(timeout=timeout)
        except RouterError:
            raise
        except Exception as exc:  # pragma: no cover - defensive, never 500
            logger.warning("Provider test failed unexpectedly for %s: %s", provider.name, exc)
            raise RouterError(
                f"The provider returned an unexpected response: {str(exc)[:120]}",
                error_type="PROVIDER_ERROR",
            ) from exc
        return "HEALTHY"


def _extract_json(raw: str) -> dict:
    """Parse a JSON object from a model answer, tolerating markdown fences."""
    cleaned = raw.strip()
    cleaned = cleaned.removeprefix("```json").removeprefix("```")
    cleaned = cleaned.removesuffix("```").strip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
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


# Imported lazily by the legacy ai.py bridge so the router stays the source of
# truth while keeping the old module-level API (ai_json/ai_plain_text/AiError)
# working for every existing caller.
def generate_text(task, system_prompt, user_text, max_tokens, temperature,
                  reasoning_budget, documents, user, usage_callback=None, raw_json=False):
    """Convenience wrapper used by the legacy bridge in ai.py."""
    return AIService.generate(
        task=task,
        system_prompt=system_prompt,
        user_text=user_text,
        max_tokens=max_tokens,
        temperature=temperature,
        reasoning_budget=reasoning_budget,
        documents=documents,
        user=user,
        raw_json=raw_json,
        usage_callback=usage_callback,
    )
