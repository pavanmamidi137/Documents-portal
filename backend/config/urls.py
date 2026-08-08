from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.accounts.views import FacultyViewSet, ResumeViewSet, StudentViewSet

router = DefaultRouter()
router.register("students", StudentViewSet, basename="students")
router.register("faculty", FacultyViewSet, basename="faculty")
router.register("resumes", ResumeViewSet, basename="resumes")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include(router.urls)),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/", include("apps.core.urls")),
    path("api/", include("apps.college.urls")),
    path("api/", include("apps.documents.urls")),
    path("api/", include("apps.announcements.urls")),
]
