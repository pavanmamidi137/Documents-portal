from django.db.models.deletion import ProtectedError
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.core.permissions import IsSuperAdminForWrite
from apps.core.utils import log_audit

from .models import Branch, Category, Section, Semester, Subject
from .serializers import (
    BranchSerializer,
    CategorySerializer,
    SectionSerializer,
    SemesterSerializer,
    SubjectSerializer,
)


class BranchViewSet(viewsets.ModelViewSet):
    queryset = Branch.objects.prefetch_related("sections").all()
    serializer_class = BranchSerializer
    permission_classes = [IsSuperAdminForWrite]
    search_fields = ["name", "code"]
    ordering_fields = ["name"]
    ordering = ["name"]

    def perform_create(self, serializer):
        instance = serializer.save()
        log_audit(self.request.user, "CREATE", "Branch", instance.id,
                  {"name": instance.name}, self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_audit(self.request.user, "UPDATE", "Branch", instance.id,
                  {"name": instance.name}, self.request)

    def perform_destroy(self, instance):
        log_audit(self.request.user, "DELETE", "Branch", instance.id,
                  {"name": instance.name}, self.request)
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                {"detail": "This branch has related records (sections, students, documents) and cannot be deleted."}
            )


class SectionViewSet(viewsets.ModelViewSet):
    queryset = Section.objects.select_related("branch").all()
    serializer_class = SectionSerializer
    permission_classes = [IsSuperAdminForWrite]
    search_fields = ["name", "branch__name"]
    ordering_fields = ["name"]
    ordering = ["branch__name", "name"]

    def get_queryset(self):
        qs = super().get_queryset()
        branch = self.request.query_params.get("branch")
        if branch:
            qs = qs.filter(branch_id=branch)
        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        log_audit(self.request.user, "CREATE", "Section", instance.id,
                  {"name": str(instance), "branch": instance.branch.name}, self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_audit(self.request.user, "UPDATE", "Section", instance.id,
                  {"name": str(instance)}, self.request)

    def perform_destroy(self, instance):
        log_audit(self.request.user, "DELETE", "Section", instance.id,
                  {"name": str(instance)}, self.request)
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                {"detail": "This section has related records (students, documents) and cannot be deleted."}
            )


class SemesterViewSet(viewsets.ModelViewSet):
    queryset = Semester.objects.all()
    serializer_class = SemesterSerializer
    permission_classes = [IsSuperAdminForWrite]
    search_fields = ["name"]
    ordering_fields = ["order"]
    ordering = ["order", "name"]

    def perform_create(self, serializer):
        instance = serializer.save()
        log_audit(self.request.user, "CREATE", "Semester", instance.id,
                  {"name": instance.name}, self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_audit(self.request.user, "UPDATE", "Semester", instance.id,
                  {"name": instance.name}, self.request)

    def perform_destroy(self, instance):
        log_audit(self.request.user, "DELETE", "Semester", instance.id,
                  {"name": instance.name}, self.request)
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                {"detail": "This semester has related documents/subjects and cannot be deleted."}
            )


class CategoryViewSet(viewsets.ModelViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [IsSuperAdminForWrite]
    search_fields = ["name"]
    ordering_fields = ["name"]
    ordering = ["name"]

    def perform_create(self, serializer):
        instance = serializer.save()
        log_audit(self.request.user, "CREATE", "Category", instance.id,
                  {"name": instance.name}, self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_audit(self.request.user, "UPDATE", "Category", instance.id,
                  {"name": instance.name}, self.request)

    def perform_destroy(self, instance):
        log_audit(self.request.user, "DELETE", "Category", instance.id,
                  {"name": instance.name}, self.request)
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                {"detail": "This category has related documents and cannot be deleted."}
            )


class SubjectViewSet(viewsets.ModelViewSet):
    queryset = Subject.objects.select_related("semester", "branch").all()
    serializer_class = SubjectSerializer
    permission_classes = [IsSuperAdminForWrite]
    search_fields = ["name", "code", "semester__name", "branch__name"]
    ordering_fields = ["name"]
    ordering = ["name"]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if params.get("semester"):
            qs = qs.filter(semester_id=params["semester"])
        if params.get("branch"):
            qs = qs.filter(branch_id=params["branch"])
        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        log_audit(self.request.user, "CREATE", "Subject", instance.id,
                  {"name": instance.name, "semester": instance.semester.name}, self.request)

    def perform_update(self, serializer):
        instance = serializer.save()
        log_audit(self.request.user, "UPDATE", "Subject", instance.id,
                  {"name": instance.name}, self.request)

    def perform_destroy(self, instance):
        log_audit(self.request.user, "DELETE", "Subject", instance.id,
                  {"name": instance.name}, self.request)
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                {"detail": "This subject has related documents and cannot be deleted."}
            )


class MetaView(viewsets.ViewSet):
    """Aggregated reference data for upload forms and student browsing."""

    def list(self, request):
        return Response(
            {
                "branches": BranchSerializer(Branch.objects.all(), many=True).data,
                "sections": SectionSerializer(
                    Section.objects.select_related("branch").all(), many=True
                ).data,
                "semesters": SemesterSerializer(Semester.objects.all(), many=True).data,
                "categories": CategorySerializer(Category.objects.all(), many=True).data,
                "subjects": SubjectSerializer(
                    Subject.objects.select_related("semester", "branch").all(), many=True
                ).data,
            }
        )
