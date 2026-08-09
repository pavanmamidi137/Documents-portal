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
    IsStudentOrCR,
    IsSuperAdmin,
    IsSuperAdminOrCR,
    IsSuperAdminOrFaculty,
)
from apps.core.throttles import AiRateThrottle, LoginRateThrottle
from apps.core.utils import (
    build_zip_response,
    csv_response,
    invalidate_portal_caches,
    log_audit,
)

from .models import AiAccessConfig, Resume, User
from .serializers import (
    AdminCreateSerializer,
    AiAccessConfigSerializer,
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


class AvatarView(APIView):
    """Upload (or replace) the signed-in user's profile picture.

    The image goes to Cloudinary under ``avatars/{roll}/`` and the URL is
    stored on the user. Sends multipart/form-data with a ``file`` field.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from apps.core.utils import slugify

        image = request.FILES.get("file")
        if not image:
            raise ValidationError({"file": "A profile picture is required."})
        if image.size > 2 * 1024 * 1024:
            raise ValidationError({"file": "Profile picture exceeds the 2MB size limit."})
        name = (image.name or "").lower()
        ext = f".{name.rpartition('.')[2]}" if "." in name else ""
        if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
            raise ValidationError({"file": "Only JPG, PNG, WEBP or GIF images are allowed."})
        try:
            import cloudinary.uploader

            result = cloudinary.uploader.upload(
                image,
                resource_type="image",
                folder=f"avatars/{slugify(request.user.roll_number)}",
                use_filename=True,
                unique_filename=True,
                overwrite=False,
            )
        except Exception as exc:
            raise ValidationError({"file": f"Cloudinary upload failed: {exc}"})
        request.user.avatar_url = result["secure_url"]
        request.user.save(update_fields=["avatar_url"])
        log_audit(request.user, "PROFILE_UPDATE", "User", request.user.id,
                  {"roll_number": request.user.roll_number, "fields": ["avatar_url"]}, request)
        return Response(UserSerializer(request.user).data)

    def delete(self, request):
        """Remove the profile picture."""
        request.user.avatar_url = ""
        request.user.save(update_fields=["avatar_url"])
        log_audit(request.user, "PROFILE_UPDATE", "User", request.user.id,
                  {"roll_number": request.user.roll_number, "fields": ["avatar_url"]}, request)
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

    def list(self, request, *args, **kwargs):
        """Paginated student list, cached ~5s per user + filters.

        Every student write path invalidates the cache, so the admin/CR
        tables always show fresh rows while repeated filtering stays fast.
        """
        from apps.core.utils import get_or_set_list_cache

        data = get_or_set_list_cache(
            "list:students",
            request.user,
            request.query_params,
            5,
            lambda: super(StudentViewSet, self).list(request, *args, **kwargs).data,
        )
        return Response(data)

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
        invalidate_portal_caches("list:students", "list:status")
        return Response(UserSerializer(student).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        student = self._get_student_or_404(kwargs["pk"])
        serializer = self.get_serializer(student, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        student = services.update_student(student, serializer.validated_data, request.user, request)
        invalidate_portal_caches("list:students", "list:status")
        return Response(UserSerializer(student).data)

    def destroy(self, request, *args, **kwargs):
        student = self._get_student_or_404(kwargs["pk"])
        if student.is_super_admin:
            raise ValidationError("Cannot delete a Super Admin.")
        services.delete_student(student, request.user, request)
        invalidate_portal_caches("list:students", "list:status")
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
        invalidate_portal_caches("list:students", "list:status")
        return Response(result)

    @action(detail=False, methods=["post"], permission_classes=[IsSuperAdminOrCR])
    def bulk_delete(self, request):
        """Delete many students in ONE request instead of one call per row.

        Pass ``{ids: [...]}`` for a specific selection, or
        ``{all_matching: true}`` (with the same search/branch/section/role
        query params as the list) to delete every matching student at once.
        Scope rules match the list/destroy endpoints: CRs may only delete
        students inside their own assigned section; Super Admins delete
        anywhere. Admin accounts are always protected. Each student's resume
        file is removed from Cloudinary before the rows are deleted.
        """
        all_matching = request.data.get("all_matching") in (True, "true", "1", 1)
        # is_super_admin is a model property (role == SUPER_ADMIN), so the
        # exclusion must be done on the stored role column. The caller is also
        # protected - deleting your own account would orphan its audit trail.
        qs = (
            self.get_queryset()
            .exclude(role=User.Role.SUPER_ADMIN)
            .exclude(pk=request.user.pk)
        )
        if all_matching:
            ids_to_delete = list(qs.values_list("id", flat=True))
            # Safety cap: a misclick on "delete all" must not wipe an entire
            # college in one request - narrow the filters instead.
            max_matches = int(getattr(settings, "BULK_DELETE_MAX_MATCHES", 5000))
            if len(ids_to_delete) > max_matches:
                raise ValidationError({
                    "detail": (
                        f"This would delete {len(ids_to_delete)} students, more than the "
                        f"{max_matches}-student bulk-delete safety limit. Narrow your search "
                        "or filters (branch/section/role) and try again."
                    )
                })
        else:
            raw_ids = request.data.get("ids")
            if not isinstance(raw_ids, list) or not raw_ids:
                raise ValidationError({"ids": "Provide a list of student ids to delete."})
            ids = [int(i) for i in raw_ids if str(i).lstrip("-").isdigit()]
            if not ids:
                raise ValidationError({"ids": "Provide valid student ids."})
            ids_to_delete = list(qs.filter(id__in=ids).values_list("id", flat=True))
        if not ids_to_delete:
            return Response({"deleted": 0})
        # Remove resume files from Cloudinary before the rows cascade.
        for resume in Resume.objects.filter(student_id__in=ids_to_delete).only("public_id"):
            if resume.public_id:
                from apps.documents.services import delete_document_file

                delete_document_file(resume.public_id)
        User.objects.filter(id__in=ids_to_delete).delete()
        # Count only the students themselves (a .delete() return value would
        # also include cascaded rows like resumes).
        count = len(ids_to_delete)
        log_audit(request.user, "BULK_DELETE", "Student", "",
                  {"count": count, "all_matching": all_matching}, request)
        invalidate_portal_caches("list:students", "list:status")
        return Response({"deleted": count})

    @action(detail=False, methods=["get"], permission_classes=[IsSuperAdminOrCR])
    def export_csv(self, request):
        qs = self.get_queryset()
        rows = [
            [s.roll_number, s.full_name, s.email or "", s.phone or "",
             s.branch.name if s.branch else "", s.section.name if s.section else "",
             s.passout_year or "", s.role, "Active" if s.is_active else "Inactive"]
            for s in qs.iterator()
        ]
        log_audit(request.user, "CSV_EXPORT", "Student", "",
                  {"count": len(rows)}, request)
        return csv_response(
            "students.csv",
            ["Roll Number", "Student Name", "Email", "Phone", "Branch", "Section", "Passout Year", "Role", "Status"],
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
        invalidate_portal_caches("list:students", "list:status")
        return Response(UserSerializer(student).data)

    @action(detail=True, methods=["post"], permission_classes=[IsSuperAdmin])
    def demote(self, request, pk=None):
        student = self._get_student_or_404(pk)
        try:
            services.demote_to_student(student, request.user, request)
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)})
        invalidate_portal_caches("list:students", "list:status")
        return Response(UserSerializer(student).data)

    @action(detail=True, methods=["post"], permission_classes=[IsSuperAdmin])
    def activate(self, request, pk=None):
        student = self._get_student_or_404(pk)
        services.set_active(student, True, request.user, request)
        invalidate_portal_caches("list:students", "list:status")
        return Response(UserSerializer(student).data)

    @action(detail=True, methods=["post"], permission_classes=[IsSuperAdmin])
    def deactivate(self, request, pk=None):
        student = self._get_student_or_404(pk)
        try:
            services.set_active(student, False, request.user, request)
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)})
        invalidate_portal_caches("list:students", "list:status")
        return Response(UserSerializer(student).data)

    @action(detail=True, methods=["post"])
    def reset_password(self, request, pk=None):
        student = self._get_student_or_404(pk)
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.reset_password(student, serializer.validated_data["new_password"], request.user, request)
        return Response({"detail": "Password reset successfully."})

    @action(detail=True, methods=["get", "patch"], permission_classes=[IsSuperAdmin])
    def ai_access(self, request, pk=None):
        """Read or update a student's AI usage limits (Super Admin).

        GET returns the effective limits plus today's usage; PATCH accepts
        ``daily_ai_requests``, ``ats_view_interval_days``,
        ``daily_resume_uploads`` and ``unlimited_ai`` (null fields fall back to
        the portal defaults).
        """
        student = self._get_student_or_404(pk)
        config, _created = AiAccessConfig.objects.get_or_create(student=student)

        if request.method == "GET":
            limits = services._effective_ai_limits(student)
            return Response({
                **AiAccessConfigSerializer(config).data,
                "effective": limits,
                "ai_requests_used_today": services._ai_requests_used_today(student),
                "resume_uploads_used_today": services._resume_uploads_used_today(student),
            })

        serializer = AiAccessConfigSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        for field, value in validated.items():
            setattr(config, field, value)
        config.updated_by = request.user
        config.save()
        log_audit(
            request.user, "UPDATE", "AiAccessConfig", student.id,
            {"roll_number": student.roll_number, **validated}, request,
        )
        return Response({
            **AiAccessConfigSerializer(config).data,
            "effective": services._effective_ai_limits(student),
            "ai_requests_used_today": services._ai_requests_used_today(student),
            "resume_uploads_used_today": services._resume_uploads_used_today(student),
        })


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
# Admin account management (Super Admin manages other admins + handover)
# ---------------------------------------------------------------------------
class AdminViewSet(viewsets.ModelViewSet):
    """Super Admin manages admin accounts.

    Create additional admin accounts, delete them (never the last one, never
    yourself) and "transfer" the role: a new admin account is created and the
    calling admin is demoted to a regular student so only one person holds
    admin access at the end of the handover.
    """

    http_method_names = ["get", "post", "delete", "head", "options"]
    permission_classes = [IsSuperAdmin]

    def get_serializer_class(self):
        if self.action == "create":
            return AdminCreateSerializer
        return UserSerializer

    def get_queryset(self):
        qs = User.objects.filter(role=User.Role.SUPER_ADMIN)
        search = self.request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(roll_number__icontains=search)
                | Q(full_name__icontains=search)
                | Q(email__icontains=search)
                | Q(phone__icontains=search)
            )
        return qs.order_by("roll_number")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        admin = serializer.save()
        log_audit(request.user, "CREATE", "Admin", admin.id,
                  {"roll_number": admin.roll_number}, request)
        return Response(UserSerializer(admin).data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        admin = self.get_object()
        # The caller is always an admin themselves, so deleting any other admin
        # can never remove the last one - the only danger is self-deletion.
        if admin.pk == request.user.pk:
            raise ValidationError(
                "You cannot delete your own admin account. Use 'Transfer admin' to hand over access."
            )
        roll = admin.roll_number
        admin.delete()
        log_audit(request.user, "DELETE", "Admin", roll,
                  {"roll_number": roll}, request)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def reset_password(self, request, pk=None):
        admin = self.get_object()
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.reset_password(
            admin, serializer.validated_data["new_password"], request.user, request
        )
        return Response({"detail": "Password reset successfully."})

    @action(detail=False, methods=["post"])
    def transfer(self, request):
        """Hand the admin role to another person.

        Creates a new SUPER_ADMIN from the payload, then demotes the calling
        admin to a regular student (clearing staff flags) so the handover is
        complete. The caller's session stops being admin immediately.
        """
        serializer = AdminCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_admin = serializer.save()
        old = request.user
        old.role = User.Role.STUDENT
        old.is_staff = False
        old.is_superuser = False
        old.save(update_fields=["role", "is_staff", "is_superuser"])
        log_audit(new_admin, "ADMIN_TRANSFER_IN", "Admin", new_admin.id,
                  {"from_roll": old.roll_number}, request)
        log_audit(old, "ADMIN_TRANSFER_OUT", "Admin", new_admin.id,
                  {"to_roll": new_admin.roll_number}, request)
        return Response({
            "admin": UserSerializer(new_admin).data,
            "transferred_from": old.roll_number,
        })


# ---------------------------------------------------------------------------
# Student resumes (students upload; faculty view their whole branch)
# ---------------------------------------------------------------------------
class ResumeViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "delete", "head", "options"]
    serializer_class = ResumeSerializer
    permission_classes = [IsSuperAdminOrFaculty]

    def list(self, request, *args, **kwargs):
        """Paginated resume list, cached ~5s per user + filters.

        Resume serialization includes AI data, so filtering/reviewing is the
        heaviest list on the site. Resume writes (incl. review toggles)
        invalidate the cache so badges stay current.
        """
        from apps.core.utils import get_or_set_list_cache

        data = get_or_set_list_cache(
            "list:resumes",
            request.user,
            request.query_params,
            5,
            lambda: super(ResumeViewSet, self).list(request, *args, **kwargs).data,
        )
        return Response(data)

    def get_permissions(self):
        # Students (and CRs - they are students too) manage their own resume;
        # faculty/admins browse the list.
        if self.action in ("create", "mine"):
            return [IsStudentOrCR()]
        if self.action in ("list", "mark_reviewed", "mark_all_reviewed", "download_zip"):
            return [IsSuperAdminOrFaculty()]
        # destroy/preview: ownership is checked in the body (owner student or admin).
        return [IsAuthenticated()]

    def get_throttles(self):
        # AI analysis costs real LLM quota - throttle it per user like the
        # other AI actions so one account can't drain the monthly budget.
        if self.action == "analyze":
            return [AiRateThrottle()]
        return super().get_throttles()

    def get_queryset(self):
        user = self.request.user
        # Resumes whose Cloudinary file was deleted are hidden from faculty
        # lists; the owning student still sees their own via ``mine``.
        qs = Resume.objects.select_related(
            "student", "student__branch", "student__section"
        ).exclude(is_missing=True)
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
        # Review-status filter: reviewed = faculty already marked it, pending = uploaded but not yet reviewed.
        status = params.get("status", "").strip().lower()
        if status in ("reviewed", "pending"):
            qs = qs.filter(is_reviewed=(status == "reviewed"))
        # CR-only filter: CRs are students too, so their resumes show alongside everyone else.
        if params.get("cr"):
            qs = qs.filter(student__role=User.Role.CR)
        return qs

    @action(detail=False, methods=["get"])
    def mine(self, request):
        """The calling student's own resume (or 404 when none uploaded)."""
        if not request.user.is_student_or_cr:
            raise PermissionDenied("Only students have a personal resume.")
        resume = Resume.objects.filter(student=request.user).first()
        if not resume:
            raise NotFound("You have not uploaded a resume yet.")
        data = ResumeSerializer(resume).data
        # Attach the student's AI limits + today's usage so the resume page can
        # show how many AI requests/upload slots remain.
        limits = services._effective_ai_limits(request.user)
        data["limits"] = {
            **limits,
            "ai_requests_used_today": services._ai_requests_used_today(request.user),
            "resume_uploads_used_today": services._resume_uploads_used_today(request.user),
        }
        return Response(data)

    def create(self, request, *args, **kwargs):
        """Students (and CRs) upload or replace their own resume."""
        if not request.user.is_student_or_cr:
            raise PermissionDenied("Only students can upload a resume.")
        resume_file = request.FILES.get("file")
        if not resume_file:
            raise ValidationError({"file": "A resume file is required."})
        resume = services.upload_resume(request.user, resume_file, request)
        data = ResumeSerializer(resume).data
        limits = services._effective_ai_limits(request.user)
        data["limits"] = {
            **limits,
            "ai_requests_used_today": services._ai_requests_used_today(request.user),
            "resume_uploads_used_today": services._resume_uploads_used_today(request.user),
        }
        return Response(data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        resume = self.get_object()
        user = request.user
        if not (user.is_super_admin or (user.is_student_or_cr and resume.student_id == user.id)):
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
        # Resume list caching: the review badge must flip instantly everywhere.
        invalidate_portal_caches("list:resumes", "list:status")
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

    @action(detail=True, methods=["get"])
    def check(self, request, pk=None):
        """Live-check a single resume against Cloudinary (students verify their own).

        Used by the student resume page so a file deleted directly in
        Cloudinary is reflected the moment the page loads.
        """
        from datetime import timedelta

        from django.utils import timezone

        from apps.documents.services import cloudinary_file_exists

        resume = Resume.objects.filter(pk=pk).first()
        if not resume:
            raise NotFound("Resume not found.")
        user = request.user
        if user.is_faculty and user.branch_id and resume.student.branch_id != user.branch_id:
            raise NotFound("Resume not found.")
        if user.is_student_or_cr and resume.student_id != user.id:
            raise PermissionDenied("You can only check your own resume.")
        exists = cloudinary_file_exists(resume.public_id)
        now = timezone.now()
        if exists is False:
            resume.is_missing = True
            resume.file_checked_at = now
            resume.restored_at = None
            resume.save(update_fields=["is_missing", "file_checked_at", "restored_at"])
        elif exists is True and resume.is_missing:
            # The file came back (restored in Cloudinary) - unhide it and mark
            # it so the student's page can show a "Restored" badge.
            resume.is_missing = False
            resume.file_checked_at = now
            resume.restored_at = now
            resume.save(update_fields=["is_missing", "file_checked_at", "restored_at"])
        elif (
            exists is True
            and resume.restored_at
            and resume.restored_at < now - timedelta(days=3)
        ):
            # The "Restored" badge fades out a few days after revival.
            resume.file_checked_at = now
            resume.restored_at = None
            resume.save(update_fields=["file_checked_at", "restored_at"])
        return Response({
            "id": resume.id,
            "is_missing": resume.is_missing,
            "restored_at": resume.restored_at,
        })

    @action(detail=False, methods=["get"], url_path="check-files")
    def check_files(self, request):
        """Verify the current view's resumes still exist on Cloudinary.

        Same instant-removal behaviour as the documents check-files: any
        resume deleted directly in Cloudinary is flagged missing and hidden
        from the faculty list immediately. Files checked within the last
        minute are skipped to protect the Cloudinary API quota, and long-
        missing resumes are re-checked so a restored file reappears.
        """
        from datetime import timedelta

        from django.utils import timezone

        from apps.documents.services import cloudinary_file_exists

        cutoff = timezone.now() - timedelta(seconds=60)
        visible = self.get_queryset().filter(
            Q(file_checked_at__lt=cutoff) | Q(file_checked_at__isnull=True)
        )[:100]
        stale_missing = Resume.objects.filter(
            is_missing=True, file_checked_at__lt=cutoff
        )[:50]
        missing_ids: list[int] = []
        restored_ids: list[int] = []
        checked = 0
        for resume in list(visible) + list(stale_missing):
            exists = cloudinary_file_exists(resume.public_id)
            if exists is None:
                continue
            checked += 1
            now = timezone.now()
            if not exists:
                if not resume.is_missing:
                    missing_ids.append(resume.id)
                Resume.objects.filter(pk=resume.pk).update(
                    is_missing=True, file_checked_at=now, restored_at=None
                )
            else:
                updates = {"is_missing": False, "file_checked_at": now}
                if resume.is_missing:
                    # The file came back (restored in Cloudinary) - unhide it
                    # with a restored marker so the UI can show a badge.
                    restored_ids.append(resume.id)
                    updates["restored_at"] = now
                elif resume.restored_at and resume.restored_at < now - timedelta(days=3):
                    # The "Restored" badge fades out a few days after revival.
                    updates["restored_at"] = None
                else:
                    continue  # unchanged - avoid a pointless write
                Resume.objects.filter(pk=resume.pk).update(**updates)
        return Response({
            "checked": checked,
            "missing_ids": missing_ids,
            "restored_ids": restored_ids,
        })

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
        # .update() skips signals - invalidate the resume list caches directly.
        invalidate_portal_caches("list:resumes", "list:status")
        log_audit(
            request.user, "RESUME_REVIEW_ALL", "Resume", "",
            {"updated": count},
            request,
        )
        return Response({"updated": count})

    @action(detail=True, methods=["post"])
    def analyze(self, request, pk=None):
        """Run the AI resume review (quality + drive matches) and cache it.

        Students analyze their own resume; faculty/admins may analyze any
        resume in their scope. The result is stored on the Resume row so
        repeated views are instant - re-run after uploading a new version or
        when new drives open.
        """
        from apps.placements.ai import AiError
        from apps.placements.resume_ai import analyze_resume

        resume = Resume.objects.select_related(
            "student", "student__branch"
        ).filter(pk=pk).first()
        if not resume:
            raise NotFound("Resume not found.")
        user = request.user
        # Only students/CRs (own resume), branch-scoped faculty and admins may
        # run the analysis.
        if not (user.is_super_admin or user.is_faculty or user.is_student_or_cr):
            raise PermissionDenied("Only students, faculty and admins can analyze resumes.")
        if user.is_student_or_cr and resume.student_id != user.id:
            raise PermissionDenied("You can only analyze your own resume.")
        if user.is_faculty and user.branch_id and resume.student.branch_id != user.branch_id:
            raise NotFound("Resume not found.")
        if resume.is_missing:
            raise ValidationError(
                {"detail": "This resume's file was deleted from storage. Re-upload it first."}
            )
        # Students/CRs have a per-day AI request budget (default 5, admin-
        # adjustable per roll number; "unlimited" bypasses it). Faculty/admin
        # reviews are not limited - they review on behalf of the college.
        if user.is_student_or_cr:
            limits = services._effective_ai_limits(user)
            if not limits["unlimited_ai"] and \
                    services._ai_requests_used_today(user) >= limits["daily_ai_requests"]:
                raise ValidationError({
                    "detail": (
                        f"You have used your {limits['daily_ai_requests']} AI request(s) for today. "
                        "Come back tomorrow, or ask the admin to raise your limit."
                    )
                })
        try:
            analyze_resume(resume, user)
        except AiError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        data = ResumeSerializer(resume).data
        if user.is_student:
            limits = services._effective_ai_limits(user)
            data["limits"] = {
                **limits,
                "ai_requests_used_today": services._ai_requests_used_today(user),
                "resume_uploads_used_today": services._resume_uploads_used_today(user),
            }
        return Response(data)

    @action(detail=True, methods=["post"])
    def ats_view(self, request, pk=None):
        """Open the full ATS report for a student's own analyzed resume.

        The report is gated to once per interval (default 10 days, admin-
        adjustable per student). The first open within an interval unlocks the
        report and records the view time; further opens within the same
        interval are blocked with the next available date.
        """
        from datetime import timedelta

        from django.conf import settings

        resume = Resume.objects.filter(pk=pk, student_id=request.user.id).first()
        if not resume:
            raise PermissionDenied("You can only open your own resume's ATS report.")
        if resume.ai_status != Resume.AiStatus.COMPLETE:
            raise ValidationError({
                "detail": "Run the AI review first - the ATS report unlocks after it completes."
            })
        limits = services._effective_ai_limits(request.user)
        interval = limits["ats_view_interval_days"]
        now = timezone.now()
        next_available = None
        locked = False
        if interval:
            if resume.ats_viewed_at:
                elapsed = now - resume.ats_viewed_at
                if elapsed < timedelta(days=interval):
                    locked = True
                    next_available = resume.ats_viewed_at + timedelta(days=interval)
            if not locked:
                resume.ats_viewed_at = now
                resume.save(update_fields=["ats_viewed_at", "updated_at"])
        return Response({
            "locked": locked,
            "next_available_at": next_available.isoformat() if next_available else None,
            "interval_days": interval or None,
            "analysis": None if locked else resume.ai_analysis,
            "ai_score": None if locked else resume.ai_score,
            "ai_match": None if locked else resume.ai_match,
        })

    @action(detail=False, methods=["get"], permission_classes=[IsSuperAdminOrFaculty])
    def student_status(self, request):
        """Every student of the caller's branch with their resume upload status.

        Faculty want to see at a glance who has uploaded a resume and who
        hasn't (plus review state), not just the resumes that exist. Includes
        the same search/branch/section filters as the resume list.
        """
        user = request.user
        if user.is_faculty and not user.has_resume_portal:
            raise PermissionDenied("Your faculty access does not include the resume portal.")
        # CRs are students too (they just carry the CR responsibility), so the
        # faculty can see their resume upload status as well.
        students = User.objects.select_related("branch", "section", "resume").filter(
            role__in=[User.Role.STUDENT, User.Role.CR]
        )
        if user.is_faculty and user.branch_id:
            students = students.filter(branch_id=user.branch_id)
        params = self.request.query_params
        search = params.get("search", "").strip()
        if search:
            students = students.filter(
                Q(roll_number__icontains=search)
                | Q(full_name__icontains=search)
                | Q(email__icontains=search)
            )
        if params.get("branch"):
            students = students.filter(branch_id=params["branch"])
        if params.get("section"):
            students = students.filter(section_id=params["section"])
        # Same status/CR filters as the resume list, applied to every student.
        # Pending excludes Cloudinary-missing resumes (those render as "Not
        # uploaded", not "Pending").
        status = params.get("status", "").strip().lower()
        if status in ("reviewed", "pending"):
            students = students.filter(
                resume__is_reviewed=(status == "reviewed"),
                resume__is_missing=False,
            )
        if params.get("cr"):
            students = students.filter(role=User.Role.CR)

        from apps.core.utils import get_or_set_list_cache

        # The All-Students table iterates every student of the branch - cache
        # the built rows ~5s per user + filters so repeated tab loads are free.
        def build_rows():
            rows = []
            for s in students.iterator():
                resume = getattr(s, "resume", None)
                rows.append({
                    "student_id": s.id,
                    "roll_number": s.roll_number,
                    "full_name": s.full_name,
                    "role": s.role,
                    "avatar_url": s.avatar_url,
                    "gender_label": s.get_gender_display() or "",
                    "branch_name": s.branch.name if s.branch else None,
                    "branch_code": s.branch.code if s.branch else "",
                    "section_name": s.section.name if s.section else None,
                    "passout_year": s.passout_year,
                    "has_resume": bool(resume and not resume.is_missing),
                    "is_reviewed": bool(resume and resume.is_reviewed),
                    "resume_id": resume.id if resume else None,
                    "file_name": resume.file_name if resume else None,
                    "updated_at": resume.updated_at if resume else None,
                    "ai_status": resume.ai_status if resume else None,
                })
            return {"results": rows}

        return Response(get_or_set_list_cache("list:status", user, params, 5, build_rows))

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
        if user.is_student_or_cr and resume.student_id != user.id:
            raise PermissionDenied("You can only preview your own resume.")
        if resume.is_missing:
            raise NotFound(
                "This resume's file was deleted from storage. Re-upload it from your profile."
            )
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
