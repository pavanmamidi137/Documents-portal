from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DocumentShareRequestViewSet, DocumentViewSet

router = DefaultRouter()
router.register("documents", DocumentViewSet, basename="documents")
router.register(
    "document-share-requests",
    DocumentShareRequestViewSet,
    basename="document-share-requests",
)

urlpatterns = [
    path("", include(router.urls)),
]
