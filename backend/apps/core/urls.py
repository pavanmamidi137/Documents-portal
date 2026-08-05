from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DashboardView, health
from .views_audit import AuditLogViewSet
from .views_search import SearchView
from .views_settings import SiteThemeView

router = DefaultRouter()
router.register("audit-logs", AuditLogViewSet, basename="audit-logs")

urlpatterns = [
    path("health/", health, name="health"),
    path("dashboard/", DashboardView.as_view(), name="dashboard"),
    path("search/", SearchView.as_view(), name="search"),
    path("site-theme/", SiteThemeView.as_view(), name="site-theme"),
    path("", include(router.urls)),
]
