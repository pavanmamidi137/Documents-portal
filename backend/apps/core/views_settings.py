import re

from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import SiteSetting
from .permissions import IsSuperAdmin
from .utils import log_audit

# Preset keys must match the frontend theme registry (frontend/src/lib/site-theme.tsx).
SITE_THEME_KEY = "site_theme"
DEFAULT_THEME = "orange"
SITE_THEMES = {
    "orange",       # Brand orange #F56D14
    "purple",       # Purple #9D4ACC
    "gray",         # Gray
    "light-green",  # Light green
    "dark-green",   # Dark green
    "brown",        # Dark brown
    "pink",         # Pink
    "dark-pink",    # Dark pink
}

# A theme can also be any color the admin picks in the color picker, stored as
# ``custom:#RRGGBB``. The frontend derives the full palette from that hex.
CUSTOM_THEME_PREFIX = "custom:"
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _is_valid_theme(value: str) -> bool:
    """Accept a preset key or a fully custom color like ``custom:#f56d14``."""
    if value in SITE_THEMES:
        return True
    return value.startswith(CUSTOM_THEME_PREFIX) and bool(
        _HEX_RE.match(value[len(CUSTOM_THEME_PREFIX):])
    )


def get_site_theme() -> str:
    """Read the persisted site theme (falling back to the default)."""
    try:
        setting = SiteSetting.objects.filter(key=SITE_THEME_KEY).first()
        if setting and _is_valid_theme(setting.value):
            return setting.value
    except Exception:
        pass
    return DEFAULT_THEME


# Whether faculty/admins may download students' resumes. The Super Admin can
# turn downloads off entirely (files stay viewable/previewable, just not
# downloadable) - enforced server-side in the resume preview/zip endpoints.
RESUME_DOWNLOAD_KEY = "resume_download_enabled"


def get_resume_download_enabled() -> bool:
    """Read the persisted setting (default: downloads allowed)."""
    try:
        setting = SiteSetting.objects.filter(key=RESUME_DOWNLOAD_KEY).first()
        if setting:
            return setting.value != "0"
    except Exception:
        pass
    return True


class SiteThemeView(APIView):
    """The portal-wide color theme.

    GET  -> public, so every visitor (even the login page) renders the theme.
    PUT  -> Super Admin only; the chosen theme is visible to all users.
    """

    permission_classes = [AllowAny]

    def get_permissions(self):
        if self.request.method in ("PUT", "PATCH"):
            return [IsSuperAdmin()]
        return [AllowAny()]

    def get(self, request):
        return Response({"theme": get_site_theme()})

    def put(self, request):
        theme = (request.data.get("theme") or "").strip().lower()
        if not _is_valid_theme(theme):
            raise ValidationError(
                {"theme": "Choose a preset theme or a custom color like custom:#f56d14."}
            )
        SiteSetting.objects.update_or_create(
            key=SITE_THEME_KEY, defaults={"value": theme}
        )
        log_audit(
            request.user, "UPDATE", "SiteSetting", SITE_THEME_KEY,
            {"theme": theme}, request,
        )
        return Response({"theme": theme})


class ResumeDownloadSettingView(APIView):
    """Whether students' resumes can be downloaded.

    GET -> any visitor reads the flag (downloads may be hidden in the UI
           accordingly). PUT -> Super Admin only; turns resume downloads
           on/off portal-wide.
    """

    permission_classes = [AllowAny]

    def get_permissions(self):
        if self.request.method in ("PUT", "PATCH"):
            return [IsSuperAdmin()]
        return [AllowAny()]

    def get(self, request):
        return Response({"resume_download_enabled": get_resume_download_enabled()})

    def put(self, request):
        enabled = bool(request.data.get("enabled", True))
        if isinstance(request.data.get("enabled"), str):
            enabled = request.data["enabled"].lower() in ("1", "true", "yes", "on")
        SiteSetting.objects.update_or_create(
            key=RESUME_DOWNLOAD_KEY, defaults={"value": "1" if enabled else "0"}
        )
        log_audit(
            request.user, "UPDATE", "SiteSetting", RESUME_DOWNLOAD_KEY,
            {"resume_download_enabled": enabled}, request,
        )
        return Response({"resume_download_enabled": enabled})
