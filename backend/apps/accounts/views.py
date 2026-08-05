from django.db.models import Q
from django.conf import settings
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.core.permissions import IsSuperAdmin, IsSuperAdminOrCR
from apps.core.throttles import LoginRateThrottle
from apps.core.utils import csv_response, log_audit

from .models import User
from .serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    ResetPasswordSerializer,
    StudentCreateSerializer,
    StudentUpdateSerializer,
    UserSerializer,
)
from . import services


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------
class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    throttle_classes = [LoginRateThrottle]

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        user = User.objects.filter(roll_number=request.data.get("roll_number", "").strip()).first()
        if user and response.status_code == status.HTTP_200_OK:
            log_audit(user, "LOGIN", "User", user.id,
                      {"roll_number": user.roll_number, "role": user.role}, request)
        return response


class RefreshView(TokenRefreshView):
    """Standard refresh endpoint (returns new access + rotated refresh)."""


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        log_audit(request.user, "PASSWORD_RESET", "User", request.user.id,
                  {"roll_number": request.user.roll_number, "self": True}, request)
        return Response({"detail": "Password changed successfully."})


class LogoutView(APIView):
    """Blacklist the refresh token so it can no longer be used."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        refresh = request.data.get("refresh")
        if refresh:
            try:
                RefreshToken(refresh).blacklist()
            except Exception:
                pass  # already blacklisted / invalid - nothing to do
        log_audit(request.user, "LOGOUT", "User", request.user.id,
                  {"roll_number": request.user.roll_number}, request)
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Student management (Super Admin + CR scoped to own section)
# ---------------------------------------------------------------------------
class StudentViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_serializer_class(self):
        if self.action in ("create",):
            return StudentCreateSerializer
        if self.action in ("update", "partial_update"):
            return StudentUpdateSerializer
        return UserSerializer

    def get_permissions(self):
        if self.action in ("promote", "demote", "activate", "deactivate"):
            return [IsSuperAdmin()]
        return [IsSuperAdminOrCR()]

    def get_queryset(self):
        user = self.request.user
        qs = User.objects.select_related("branch", "section").filter(
            role__in=[User.Role.STUDENT, User.Role.CR]
        )
        if user.is_cr:
            qs = qs.filter(branch_id=user.branch_id, section_id=user.section_id)

        params = self.request.query_params
        search = params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(roll_number__icontains=search)
                | Q(full_name__icontains=search)
                | Q(email__icontains=search)
                | Q(phone__icontains=search)
            )
        if params.get("branch"):
            qs = qs.filter(branch_id=params["branch"])
        if params.get("section"):
            qs = qs.filter(section_id=params["section"])
        if params.get("role"):
            qs = qs.filter(role=params["role"].upper())
        if params.get("active") is not None:
            qs = qs.filter(is_active=params["active"].lower() in ("1", "true", "yes"))
        return qs.order_by("roll_number")

    def _get_student_or_404(self, pk) -> User:
        student = self.get_queryset().filter(pk=pk).first()
        if not student:
            raise PermissionDenied("Student not found or outside your scope.")
        return student

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        student = services.create_student(
            serializer.validated_data, request.user, request=request
        )
        return Response(UserSerializer(student).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        student = self._get_student_or_404(kwargs["pk"])
        serializer = self.get_serializer(student, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        student = services.update_student(student, serializer.validated_data, request.user, request)
        return Response(UserSerializer(student).data)

    def destroy(self, request, *args, **kwargs):
        student = self._get_student_or_404(kwargs["pk"])
        if student.is_super_admin:
            raise ValidationError("Cannot delete a Super Admin.")
        services.delete_student(student, request.user, request)
        return Response(status=status.HTTP_204_NO_CONTENT)

    # -- bulk import / export -----------------------------------------------
    @action(detail=False, methods=["post"], permission_classes=[IsSuperAdmin])
    def import_csv(self, request):
        file = request.FILES.get("file")
        if not file:
            raise ValidationError({"file": "A CSV file is required."})
        if not file.name.lower().endswith(".csv"):
            raise ValidationError({"file": "Only .csv files are allowed."})
        max_bytes = int(getattr(settings, "CSV_MAX_SIZE_MB", 10)) * 1024 * 1024
        if file.size > max_bytes:
            raise ValidationError({"file": "CSV file exceeds the 10MB size limit."})
        try:
            result = services.import_students_csv(file, request.user, request)
        except ValueError as exc:
            raise ValidationError({"file": str(exc)})
        return Response(result)

    @action(detail=False, methods=["get"], permission_classes=[IsSuperAdminOrCR])
    def export_csv(self, request):
        qs = self.get_queryset()
        rows = [
            [s.roll_number, s.full_name, s.email or "", s.phone or "",
             s.branch.name if s.branch else "", s.section.name if s.section else "",
             s.role, "Active" if s.is_active else "Inactive"]
            for s in qs.iterator()
        ]
        log_audit(request.user, "CSV_EXPORT", "Student", "",
                  {"count": len(rows)}, request)
        return csv_response(
            "students.csv",
            ["Roll Number", "Student Name", "Email", "Phone", "Branch", "Section", "Role", "Status"],
            rows,
        )

    # -- role / status actions -------------------------------------------------
    @action(detail=True, methods=["post"], permission_classes=[IsSuperAdmin])
    def promote(self, request, pk=None):
        student = self._get_student_or_404(pk)
        try:
            services.promote_to_cr(student, request.user, request)
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)})
        return Response(UserSerializer(student).data)

    @action(detail=True, methods=["post"], permission_classes=[IsSuperAdmin])
    def demote(self, request, pk=None):
        student = self._get_student_or_404(pk)
        try:
            services.demote_to_student(student, request.user, request)
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)})
        return Response(UserSerializer(student).data)

    @action(detail=True, methods=["post"], permission_classes=[IsSuperAdmin])
    def activate(self, request, pk=None):
        student = self._get_student_or_404(pk)
        services.set_active(student, True, request.user, request)
        return Response(UserSerializer(student).data)

    @action(detail=True, methods=["post"], permission_classes=[IsSuperAdmin])
    def deactivate(self, request, pk=None):
        student = self._get_student_or_404(pk)
        try:
            services.set_active(student, False, request.user, request)
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)})
        return Response(UserSerializer(student).data)

    @action(detail=True, methods=["post"])
    def reset_password(self, request, pk=None):
        student = self._get_student_or_404(pk)
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.reset_password(student, serializer.validated_data["new_password"], request.user, request)
        return Response({"detail": "Password reset successfully."})
