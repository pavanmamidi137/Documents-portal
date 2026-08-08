from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DriveViewSet

router = DefaultRouter()
router.register("drives", DriveViewSet, basename="drives")

urlpatterns = [
    path("", include(router.urls)),
]
