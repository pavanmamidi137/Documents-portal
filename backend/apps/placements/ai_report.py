"""Daily AI health report for the super admin.

``build_daily_report()`` summarises the last 24h of AIRequestLog rows:
provider uptime (success rate), failure counts by error type, token usage and
an estimated cost (configurable per-million-token price via the
``ai_cost_per_million_tokens`` site setting, defaulting to a modest $0.50).

The report is delivered as an in-app notification to every active Super Admin
(link: the AI Management page). ``notify_admins_daily_report()`` no-ops when
there is nothing to report (no admins / no AI activity / AI disabled).
"""

from datetime import timedelta
from math import ceil

from django.db.models import Count, Q, Sum
from django.utils import timezone

from apps.accounts.models import User
from apps.core.models import Notification, SiteSetting
from apps.core.utils import notify

from .ai_models import AIRequestLog

_COST_KEY = "ai_cost_per_million_tokens"
_DEFAULT_COST_PER_MILLION = 0.50  # USD per 1M total tokens (prompt+completion)


def _cost_per_million() -> float:
    try:
        setting = SiteSetting.objects.filter(key=_COST_KEY).first()
        if setting:
            return max(0.0, float(str(setting.value) or 0))
    except (TypeError, ValueError):
        pass
    return _DEFAULT_COST_PER_MILLION


def estimate_cost(prompt_tokens: int, completion_tokens: int) -> float:
    """Rough USD cost for a token count at the configured per-million rate."""
    total = prompt_tokens + completion_tokens
    return round(total / 1_000_000 * _cost_per_million(), 4)


def build_daily_report(days: int = 1):
    """Aggregate the last ``days`` days of AI request logs.

    Returns a dict with per-provider and total rows, or None when there are no
    logs in the window (so callers can skip notifying).
    """
    since = timezone.now() - timedelta(days=days)
    logs = AIRequestLog.objects.filter(created_at__gte=since)
    total_calls = logs.count()
    if total_calls == 0:
        return None

    totals = logs.aggregate(
        success=Count("id", filter=Q(status=AIRequestLog.Status.SUCCESS)),
        errors=Count("id", filter=Q(status=AIRequestLog.Status.FAILED)),
        fallbacks=Count("id", filter=Q(fallback_used=True)),
        prompt_tokens=Sum("prompt_tokens"),
        completion_tokens=Sum("completion_tokens"),
    )
    prompt_tokens = int(totals["prompt_tokens"] or 0)
    completion_tokens = int(totals["completion_tokens"] or 0)

    # Most common failure causes (top 3) for the admin to act on. Failures
    # without a typed error are bucketed as UNKNOWN so the totals count is
    # always traceable back to the top-errors list.
    error_types = list(
        logs.filter(status=AIRequestLog.Status.FAILED)
        .values("error_type")
        .annotate(count=Count("id"))
        .order_by("-count")[:3]
    )
    for e in error_types:
        if not e["error_type"]:
            e["error_type"] = "UNKNOWN"

    providers = {}
    for row in (
        logs.exclude(provider_used="")
        .values("provider_used")
        .annotate(
            calls=Count("id"),
            ok=Count("id", filter=Q(status=AIRequestLog.Status.SUCCESS)),
            err=Count("id", filter=Q(status=AIRequestLog.Status.FAILED)),
            prompt=Sum("prompt_tokens"),
            completion=Sum("completion_tokens"),
        )
        .order_by("-calls")
    ):
        name = row["provider_used"]
        ok = int(row["ok"] or 0)
        err = int(row["err"] or 0)
        pt = int(row["prompt"] or 0)
        ct = int(row["completion"] or 0)
        providers[name] = {
            "calls": int(row["calls"] or 0),
            "success": ok,
            "errors": err,
            "uptime_pct": round(ok / max(1, ok + err) * 100, 1),
            "prompt_tokens": pt,
            "completion_tokens": ct,
            "estimated_cost": estimate_cost(pt, ct),
        }

    return {
        "window_days": days,
        "totals": {
            "calls": total_calls,
            "success": int(totals["success"] or 0),
            "errors": int(totals["errors"] or 0),
            "fallbacks": int(totals["fallbacks"] or 0),
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "estimated_cost": estimate_cost(prompt_tokens, completion_tokens),
        },
        "top_error_types": [
            {"type": e["error_type"], "count": e["count"]} for e in error_types
        ],
        "providers": providers,
    }


def _summary_line(report: dict) -> str:
    """Compact human summary of the report (fits the notification message)."""
    t = report["totals"]
    cost = f"~${t['estimated_cost']:.2f}" if t["estimated_cost"] else "$0.00"
    parts = [
        f"{t['calls']} calls · {t['success']} ok · {t['errors']} errors"
        f" · {t['fallbacks']} fallbacks · {cost}"
    ]
    top = report.get("top_error_types") or []
    if top:
        joined = ", ".join(f"{e['type']}×{e['count']}" for e in top)
        parts.append(f"top errors: {joined}")
    if report.get("providers"):
        up = ", ".join(
            f"{name} {p['uptime_pct']}%" for name, p in list(report["providers"].items())[:3]
        )
        parts.append(f"uptime: {up}")
    return " · ".join(parts)


def notify_admins_daily_report(report: dict | None = None, days: int = 1) -> int:
    """Send the AI health report to every active Super Admin.

    ``days`` only matters when ``report`` is built here - pass a pre-built
    report to control the window externally. Returns the number of
    notifications created (0 when nothing to report).
    """
    if report is None:
        report = build_daily_report(days=days)
    if not report:
        return 0
    admins = User.objects.filter(role=User.Role.SUPER_ADMIN, is_active=True)
    if not admins.exists():
        return 0
    window_days = report.get("window_days", days)
    title = f"AI health report (last {window_days} day{'s' if window_days != 1 else ''})"
    return notify(
        admins,
        Notification.Kind.AI_REPORT,
        title,
        _summary_line(report)[:480],
        "/admin/ai",
    )



