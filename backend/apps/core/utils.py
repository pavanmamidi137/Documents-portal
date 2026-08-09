"""Shared helpers used across the portal's service layer."""

import csv
import io
import re
import sys
import unicodedata
import uuid

from django.http import HttpResponse

from .models import AuditLog, Notification


# ---------------------------------------------------------------------------
# Response caching (portal cache alias)
# ---------------------------------------------------------------------------
# Heavy read endpoints (meta / dashboard / document tree) cache their JSON in
# the ``portal`` cache alias for a few seconds. Writes bump a per-group
# "generation" token, which changes every cached key for that group - an
# O(1) invalidation that works on any cache backend (LocMem here).

_PORTAL_CACHE_TIMEOUT = 60


def portal_caching_enabled() -> bool:
    """Caching is disabled while running the test suite so assertions always
    see freshly-written rows (the cache is per-process and survives between
    tests)."""
    return "test" not in sys.argv


def portal_version(group: str) -> str:
    """Opaque generation token for a cached group. Bumping it (via
    ``invalidate_portal_caches``) makes every old key in that group a miss."""
    from django.core.cache import caches

    return caches["portal"].get(f"gen:{group}") or "0"


def invalidate_portal_caches(*groups: str) -> None:
    """Drop every cached response in the given groups. Never raises."""
    try:
        from django.core.cache import caches

        cache = caches["portal"]
        for group in groups:
            cache.set(f"gen:{group}", uuid.uuid4().hex, _PORTAL_CACHE_TIMEOUT)
    except Exception:
        pass


def get_client_ip(request):
    """Best-effort client IP extraction (respecting common proxies)."""
    fwd = request.META.get("HTTP_X_FORWARDED_FOR")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def log_audit(actor, action, target_type="", target_id="", details=None, request=None):
    """Persist an audit log entry. Never raises."""
    if actor is not None and not getattr(actor, "is_authenticated", False):
        actor = None
    try:
        AuditLog.objects.create(
            actor=actor,
            action=action,
            target_type=target_type,
            target_id=str(target_id or ""),
            details=details or {},
            ip_address=get_client_ip(request) if request else None,
        )
    except Exception:  # pragma: no cover - audit must never break the request
        pass


def notify(users, kind, title, message, link=""):
    """Fan out an in-app notification to a list of users. Never raises."""
    try:
        recipients = [u for u in users if u is not None and getattr(u, "is_active", True)]
        if not recipients:
            return 0
        Notification.objects.bulk_create(
            [
                Notification(
                    user=u, kind=kind, title=title, message=message, link=link
                )
                for u in recipients
            ]
        )
        return len(recipients)
    except Exception:  # pragma: no cover - notifications must never break the request
        return 0


def csv_safe(value) -> str:
    """Neutralize CSV formula injection (Excel treats leading = + - @ as formulas)."""
    text = str(value or "")
    if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text
    return text


def csv_response(filename: str, headers: list[str], rows: list[list]) -> HttpResponse:
    """Build a downloadable CSV response with formula-injection protection."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([csv_safe(h) for h in headers])
    writer.writerows([[csv_safe(cell) for cell in row] for row in rows])
    response = HttpResponse(buffer.getvalue(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def build_zip_response(files: list[tuple[str, bytes]], filename: str) -> HttpResponse:
    """Bundle files into an in-memory ZIP download response.

    Duplicate file names get a numeric suffix so every entry stays unique.
    """
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        used: set[str] = set()
        for raw_name, data in files:
            safe = raw_name.replace("\\", "/").rsplit("/", 1)[-1].strip() or "file"
            base, count, name = safe, 1, safe
            while name.lower() in used:
                stem, _, ext = base.rpartition(".")
                name = f"{stem}-{count}.{ext}" if ext else f"{base}-{count}"
                count += 1
            used.add(name.lower())
            zf.writestr(name, data)
    buffer.seek(0)
    response = HttpResponse(buffer.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def slugify(value: str) -> str:
    """URL/Cloudinary-folder-safe slug."""
    value = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value or "general"
