from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import SiteSetting
from .permissions import IsSuperAdmin
from .utils import log_audit

# Keys must match the frontend theme registry (frontend/src/lib/site-theme.tsx).
SITE_THEME_KEY = "site_theme"
DEFAULT_THEME = "default"
SITE_THEMES = {
    "default",   # Indigo / Violet
    "flame",     # Orange
    "ocean",     # Blue
    "forest",    # Green
    "royal",     # Purple
    "rose",      # Pink / Red
    "graphite",  # Slate / Black
}


def get_site_theme() -> str:
    """Read the persisted site theme (falling back to the default)."""
    try:
        setting = SiteSetting.objects.filter(key=SITE_THEME_KEY).first()
        if setting and setting.value in SITE_THEMES:
            return setting.value
    except Exception:
        pass
    return DEFAULT_THEME


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
        if theme not in SITE_THEMES:
            raise ValidationError(
                {"theme": f"Unknown theme. Choose one of: {', '.join(sorted(SITE_THEMES))}."}
            )
        SiteSetting.objects.update_or_create(
            key=SITE_THEME_KEY, defaults={"value": theme}
        )
        log_audit(
            request.user, "UPDATE", "SiteSetting", SITE_THEME_KEY,
            {"theme": theme}, request,
        )
        return Response({"theme": theme})
