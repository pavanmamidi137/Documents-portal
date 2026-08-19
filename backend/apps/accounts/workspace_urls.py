from django.urls import path

from .workspace_views import (
    AdminWorkspaceListView,
    AdminWorkspaceToggleView,
    StudentWorkspaceCompileView,
    StudentWorkspaceGenerateView,
    StudentWorkspaceSubmitView,
    StudentWorkspaceView,
)

urlpatterns = [
    # Student endpoints
    path("", StudentWorkspaceView.as_view(), name="workspace"),
    path("generate/", StudentWorkspaceGenerateView.as_view(), name="workspace-generate"),
    path("compile/", StudentWorkspaceCompileView.as_view(), name="workspace-compile"),
    path("submit/", StudentWorkspaceSubmitView.as_view(), name="workspace-submit"),
    # Admin endpoints
    path("admin/", AdminWorkspaceListView.as_view(), name="workspace-admin-list"),
    path("admin/toggle/", AdminWorkspaceToggleView.as_view(), name="workspace-admin-toggle"),
]
