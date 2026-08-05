"""Shared helpers used across the portal's service layer."""

import csv
import io
import re
import unicodedata

from django.http import HttpResponse

from .models import AuditLog


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


def slugify(value: str) -> str:
    """URL/Cloudinary-folder-safe slug."""
    value = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value or "general"
