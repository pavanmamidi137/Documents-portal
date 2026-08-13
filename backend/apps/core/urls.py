from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DashboardView, health
from .views_audit import AuditLogViewSet
from .views_contact import ContactRequestViewSet
from .views_notifications import NotificationViewSet
from .views_search import SearchView
from .views_settings import ResumeDownloadSettingView, SiteThemeView

router = DefaultRouter()
router.register("audit-logs", AuditLogViewSet, basename="audit-logs")
router.register("notifications", NotificationViewSet, basename="notifications")
router.register("contact-requests", ContactRequestViewSet, basename="contact-requests")

urlpatterns = [
    path("health/", health, name="health"),
    path("dashboard/", DashboardView.as_view(), name="dashboard"),
    path("search/", SearchView.as_view(), name="search"),
    path("site-theme/", SiteThemeView.as_view(), name="site-theme"),
    path("resume-download-setting/", ResumeDownloadSettingView.as_view(), name="resume-download-setting"),
    path("", include(router.urls)),
]
