from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    BranchViewSet,
    CategoryViewSet,
    MetaView,
    SectionViewSet,
    SemesterViewSet,
    SubjectViewSet,
)

router = DefaultRouter()
router.register("branches", BranchViewSet, basename="branches")
router.register("sections", SectionViewSet, basename="sections")
router.register("semesters", SemesterViewSet, basename="semesters")
router.register("categories", CategoryViewSet, basename="categories")
router.register("subjects", SubjectViewSet, basename="subjects")

urlpatterns = [
    path("meta/", MetaView.as_view({"get": "list"}), name="meta"),
    path("", include(router.urls)),
]
