from django.urls import include, path
from rest_framework.routers import DefaultRouter

from django.urls import path

from .ai_admin import (
    AIHealthViewSet,
    AIProviderViewSet,
    AISettingsView,
    AITaskViewSet,
    AIUsageViewSet,
)
from .views import DriveViewSet

router = DefaultRouter()
router.register("drives", DriveViewSet, basename="drives")

# Super Admin-only AI Provider Manager endpoints.
ai_admin_router = DefaultRouter()
ai_admin_router.register("providers", AIProviderViewSet, basename="ai-providers")
ai_admin_router.register("tasks", AITaskViewSet, basename="ai-tasks")
ai_admin_router.register("health", AIHealthViewSet, basename="ai-health")
ai_admin_router.register("usage", AIUsageViewSet, basename="ai-usage")

urlpatterns = [
    path("", include(router.urls)),
    path("admin/ai/settings/", AISettingsView.as_view(), name="ai-settings"),
    path("admin/ai/", include(ai_admin_router.urls)),
]
