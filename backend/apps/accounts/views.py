import urllib.error
import urllib.request

from django.db.models import Q
from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.core.permissions import (
    IsStudent,
    IsSuperAdmin,
    IsSuperAdminOrCR,
    IsSuperAdminOrFaculty,
)
from apps.core.throttles import LoginRateThrottle
from apps.core.utils import build_zip_response, csv_response, log_audit

from .models import Resume, User
from .serializers import (
    ChangePasswordSerializer,
    FacultyCreateSerializer,
    FacultyUpdateSerializer,
    LoginSerializer,
    ProfileUpdateSerializer,
    ResetPasswordSerializer,
    ResumeSerializer,
    StudentCreateSerializer,
    StudentUpdateSerializer,
    UserSerializer,
)
from . import services


def _resume_content_type(file_name: str) -> str:
    """Map a resume file name to its browser content type."""
    name = (file_name or "").lower()
    if name.endswith(".pdf"):
        return "application/pdf"
    if name.endswith(".docx"):
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if name.endswith(".doc"):
        return "application/msword"
    return "application/octet-stream"


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------
class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    throttle_classes = [LoginRateThrottle]

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        roll_input = request.data.get("roll_number", "").strip()
        user = User.objects.filter(roll_number__iexact=roll_input).first()
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

    def patch(self, request):
        """Let users update their own name / email / phone.

        Identity fields (roll number, branch, section, role) can only be
        changed by a Super Admin through the student management endpoints.
        """
        serializer = ProfileUpdateSerializer(
            request.user, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            setattr(request.user, field, value)
        request.user.save()
        log_audit(request.user, "PROFILE_UPDATE", "User", request.user.id,
                  {"roll_number": request.user.roll_number, "fields": list(serializer.validated_data)}, request)
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
    @action(detail=False, methods=["post"], permission_classes=[IsSuperAdminOrCR])
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
            result = services.import_students_csv(
                file,
                request.user,
                request,
                branch_id=request.data.get("branch"),
                section_id=request.data.get("section"),
            )
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


# ---------------------------------------------------------------------------
# Faculty management (Super Admin)
# ---------------------------------------------------------------------------
class FacultyViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    permission_classes = [IsSuperAdmin]
    serializer_class = UserSerializer

    def get_queryset(self):
        qs = User.objects.select_related("branch", "section").filter(
            role=User.Role.FACULTY
        )
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
        return qs.order_by("roll_number")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        faculty = serializer.save()
        log_audit(request.user, "CREATE", "Faculty", faculty.id,
                  {"roll_number": faculty.roll_number, "branch": faculty.branch_id}, request)
        return Response(UserSerializer(faculty).data, status=status.HTTP_201_CREATED)

    def get_serializer_class(self):
        if self.action == "create":
            return FacultyCreateSerializer
        if self.action in ("update", "partial_update"):
            return FacultyUpdateSerializer
        return UserSerializer

    def partial_update(self, request, *args, **kwargs):
        faculty = self.get_object()
        serializer = self.get_serializer(
            faculty, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        password = serializer.validated_data.pop("password", None)
        for field, value in serializer.validated_data.items():
            setattr(faculty, field, value)
        if password:
            faculty.set_password(password)
        faculty.save()
        log_audit(request.user, "UPDATE", "Faculty", faculty.id,
                  {"roll_number": faculty.roll_number}, request)
        return Response(UserSerializer(faculty).data)

    def destroy(self, request, *args, **kwargs):
        faculty = self.get_object()
        roll = faculty.roll_number
        faculty.delete()
        log_audit(request.user, "DELETE", "Faculty", roll, {"roll_number": roll}, request)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def reset_password(self, request, pk=None):
        faculty = self.get_object()
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.reset_password(faculty, serializer.validated_data["new_password"], request.user, request)
        return Response({"detail": "Password reset successfully."})


# ---------------------------------------------------------------------------
# Student resumes (students upload; faculty view their whole branch)
# ---------------------------------------------------------------------------
class ResumeViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "delete", "head", "options"]
    serializer_class = ResumeSerializer
    permission_classes = [IsSuperAdminOrFaculty]

    def get_permissions(self):
        # Students manage their own resume; faculty/admins browse the list.
        if self.action in ("create", "mine"):
            return [IsStudent()]
        if self.action in ("list", "mark_reviewed", "mark_all_reviewed", "download_zip"):
            return [IsSuperAdminOrFaculty()]
        # destroy/preview: ownership is checked in the body (owner student or admin).
        return [IsAuthenticated()]

    def get_queryset(self):
        user = self.request.user
        qs = Resume.objects.select_related(
            "student", "student__branch", "student__section"
        )
        # Faculty see resumes of every section in their branch; admins see all.
        if user.is_faculty and user.branch_id:
            qs = qs.filter(student__branch_id=user.branch_id)
        params = self.request.query_params
        search = params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(student__roll_number__icontains=search)
                | Q(student__full_name__icontains=search)
                | Q(file_name__icontains=search)
            )
        if params.get("branch"):
            qs = qs.filter(student__branch_id=params["branch"])
        if params.get("section"):
            qs = qs.filter(student__section_id=params["section"])
        return qs

    @action(detail=False, methods=["get"])
    def mine(self, request):
        """The calling student's own resume (or 404 when none uploaded)."""
        if not request.user.is_student:
            raise PermissionDenied("Only students have a personal resume.")
        resume = Resume.objects.filter(student=request.user).first()
        if not resume:
            raise NotFound("You have not uploaded a resume yet.")
        return Response(ResumeSerializer(resume).data)

    def create(self, request, *args, **kwargs):
        """Students upload or replace their own resume."""
        if not request.user.is_student:
            raise PermissionDenied("Only students can upload a resume.")
        resume_file = request.FILES.get("file")
        if not resume_file:
            raise ValidationError({"file": "A resume file is required."})
        resume = services.upload_resume(request.user, resume_file, request)
        return Response(ResumeSerializer(resume).data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        resume = self.get_object()
        user = request.user
        if not (user.is_super_admin or (user.is_student and resume.student_id == user.id)):
            raise PermissionDenied("You can only delete your own resume.")
        services.delete_resume(resume, user, request)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def mark_reviewed(self, request, pk=None):
        """Faculty/admins mark a resume as reviewed (or unmark it).

        The resume must already be visible to the caller (the viewset queryset
        is branch-scoped for faculty), and review state is reset automatically
        whenever the student replaces their file.
        """
        resume = self.get_object()
        value = request.data.get("reviewed", True)
        if isinstance(value, str):
            value = value.lower() in ("1", "true", "yes", "on")
        reviewed = bool(value)

        resume.is_reviewed = reviewed
        resume.reviewed_by = request.user if reviewed else None
        resume.reviewed_at = timezone.now() if reviewed else None
        # auto_now bumps updated_at so the faculty table reflects review activity.
        resume.save(update_fields=["is_reviewed", "reviewed_by", "reviewed_at", "updated_at"])
        log_audit(
            request.user, "RESUME_REVIEW" if reviewed else "RESUME_UNREVIEW",
            "Resume", resume.id,
            {"roll_number": resume.student.roll_number, "file": resume.file_name},
            request,
        )
        return Response(ResumeSerializer(resume).data)

    @action(detail=False, methods=["get"])
    def download_zip(self, request):
        """Faculty/admins download every resume in the filtered view as one ZIP.

        Branch-scoped for faculty (same queryset as the list). Files are
        fetched via signed Cloudinary URLs; capped at 100 files / 150MB.
        """
        import urllib.request

        from apps.documents.services import signed_raw_url

        max_files = 100
        max_bytes = 150 * 1024 * 1024
        files: list[tuple[str, bytes]] = []
        skipped = 0
        total = 0
        for resume in self.get_queryset()[:max_files]:
            try:
                with urllib.request.urlopen(signed_raw_url(resume.public_id), timeout=10) as resp:
                    data = resp.read()
                if total + len(data) > max_bytes:
                    skipped += 1
                    continue
                files.append((resume.file_name, data))
                total += len(data)
            except Exception:
                skipped += 1
        if not files:
            raise ValidationError({
                "detail": "No resumes could be downloaded. Check the Cloudinary 'Allow delivery of PDF and ZIP files' setting (Settings > Security)."
            })
        log_audit(request.user, "ZIP_DOWNLOAD", "Resume", "",
                  {"count": len(files), "skipped": skipped}, request)
        return build_zip_response(files, "resumes.zip")

    @action(detail=False, methods=["post"])
    def mark_all_reviewed(self, request):
        """Mark every resume in the current filtered view as reviewed.

        The viewset queryset applies the caller's branch scope and the same
        search/branch/section filters as the list endpoint, so this marks all
        resumes the faculty member can currently see.
        """
        qs = self.get_queryset()
        now = timezone.now()
        count = qs.filter(is_reviewed=False).update(
            is_reviewed=True,
            reviewed_by=request.user,
            reviewed_at=now,
            # .update() skips auto_now, so set updated_at explicitly.
            updated_at=now,
        )
        log_audit(
            request.user, "RESUME_REVIEW_ALL", "Resume", "",
            {"updated": count},
            request,
        )
        return Response({"updated": count})

    @action(detail=True, methods=["get"], url_path="preview")
    def preview(self, request, pk=None):
        """Stream the resume file with correct headers so the browser can render it.

        Cloudinary may restrict anonymous delivery (signed URLs / ACL), which
        makes plain raw URLs return HTTP 401 and the browser's PDF viewer show
        "Failed to load PDF document". Fetching through a signed delivery URL
        and streaming with the right headers fixes the preview for every
        browser while keeping the file behind the portal's authentication.
        """
        # Fetch the resume without the list filters (search/branch/section query
        # params must not affect a detail lookup), then apply scope manually.
        resume = Resume.objects.select_related(
            "student", "student__branch", "student__section"
        ).filter(pk=pk).first()
        if not resume:
            raise NotFound("Resume not found.")
        user = request.user
        if user.is_faculty and user.branch_id and resume.student.branch_id != user.branch_id:
            raise NotFound("Resume not found.")
        if user.is_student and resume.student_id != user.id:
            raise PermissionDenied("You can only preview your own resume.")
        try:
            from apps.documents.services import signed_raw_url

            with urllib.request.urlopen(signed_raw_url(resume.public_id), timeout=30) as resp:
                content = resp.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                raise ValidationError(
                    {"file": "Cloudinary is blocking file delivery. Enable 'Allow delivery of PDF and ZIP files' in the Cloudinary Security settings (Settings > Security), then try again."}
                )
            raise NotFound("Could not load the resume file from storage.")
        except Exception:
            raise NotFound("Could not load the resume file from storage.")
        download = request.query_params.get("download", "").lower() in ("1", "true", "yes")
        disposition = "attachment" if download else "inline"
        response = HttpResponse(
            content, content_type=_resume_content_type(resume.file_name)
        )
        response["Content-Disposition"] = f'{disposition}; filename="{resume.file_name}"'
        return response
