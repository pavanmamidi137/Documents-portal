import re

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models


def derive_passout_year(roll: str):
    """Guess a student's pass-out year from a roll number's leading 2 digits.

    ``21CSE01`` -> admitted 2021 -> passes out 2025 (4-year degree). Returns
    None when the roll number carries no usable year prefix.
    """
    match = re.match(r"^(\d{2})", roll or "")
    if not match:
        return None
    year = 2000 + int(match.group(1)) + 4
    return year if 1990 <= year <= 2100 else None


class UserManager(BaseUserManager):
    """Manager for the roll-number-based User model."""

    use_in_migrations = True

    def _create_user(self, roll_number, password, **extra_fields):
        if not roll_number:
            raise ValueError("Roll number must be set")
        email = extra_fields.pop("email", None)
        if email:
            email = self.normalize_email(email)
        user = self.model(roll_number=roll_number, email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, roll_number, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(roll_number, password, **extra_fields)

    def create_superuser(self, roll_number, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", User.Role.SUPER_ADMIN)
        if extra_fields.get("role") != User.Role.SUPER_ADMIN:
            raise ValueError("Superuser must have role SUPER_ADMIN")
        return self._create_user(roll_number, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    """Portal user identified by roll number, with one of three roles."""

    class Role(models.TextChoices):
        SUPER_ADMIN = "SUPER_ADMIN", "Super Admin"
        CR = "CR", "CR (Sub Admin)"
        FACULTY = "FACULTY", "Faculty"
        STUDENT = "STUDENT", "Student"

    class Gender(models.TextChoices):
        MALE = "MALE", "Male"
        FEMALE = "FEMALE", "Female"
        OTHER = "OTHER", "Other"

    # Which portal each faculty account may access. Admin decides per faculty
    # member: resume review only, placement drives only, or both.
    class FacultyAccess(models.TextChoices):
        RESUME = "RESUME", "Resume Portal"
        PLACEMENT = "PLACEMENT", "Placement Portal"
        BOTH = "BOTH", "Both"

    roll_number = models.CharField(max_length=30, unique=True)
    full_name = models.CharField(max_length=150)
    email = models.EmailField(unique=True, null=True, blank=True)
    phone = models.CharField(max_length=20, blank=True, default="")
    gender = models.CharField(
        max_length=10, choices=Gender.choices, blank=True, default="",
        help_text="Optional - collected during student import or profile edits.",
    )
    # Optional profile picture (Cloudinary URL) for every role.
    avatar_url = models.URLField(max_length=500, blank=True, default="")
    # Only meaningful for FACULTY: which portal(s) they can use.
    faculty_access = models.CharField(
        max_length=10, choices=FacultyAccess.choices,
        default=FacultyAccess.BOTH, blank=True,
    )
    passout_year = models.PositiveSmallIntegerField(
        null=True, blank=True,
        help_text="Batch pass-out year (e.g. 2025) - shown next to every student.",
    )
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.STUDENT)
    branch = models.ForeignKey(
        "college.Branch", null=True, blank=True, on_delete=models.SET_NULL, related_name="students"
    )
    section = models.ForeignKey(
        "college.Section", null=True, blank=True, on_delete=models.SET_NULL, related_name="students"
    )
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(auto_now_add=True)

    objects = UserManager()

    USERNAME_FIELD = "roll_number"
    REQUIRED_FIELDS = ["full_name"]

    class Meta:
        ordering = ["roll_number"]

    def __str__(self) -> str:
        return f"{self.roll_number} ({self.full_name})"

    # ------------------------------------------------------------------
    # Role helpers
    # ------------------------------------------------------------------
    @property
    def is_super_admin(self) -> bool:
        return self.role == self.Role.SUPER_ADMIN

    @property
    def is_cr(self) -> bool:
        return self.role == self.Role.CR

    @property
    def is_faculty(self) -> bool:
        return self.role == self.Role.FACULTY

    @property
    def is_student(self) -> bool:
        return self.role == self.Role.STUDENT

    @property
    def is_student_or_cr(self) -> bool:
        """CRs are students too - they just carry the CR responsibility."""
        return self.role in (self.Role.STUDENT, self.Role.CR)

    @property
    def role_label(self) -> str:
        return self.Role(self.role).label if self.role in self.Role.values else self.role

    def can_manage_section(self, section) -> bool:
        """Super admins manage everything; CRs only their assigned section."""
        if self.is_super_admin:
            return True
        return bool(self.is_cr and section and self.section_id == section.id)

    def can_manage_branch(self, branch) -> bool:
        """Super admins manage every branch; faculty only their assigned branch."""
        if self.is_super_admin:
            return True
        return bool(self.is_faculty and branch and self.branch_id == branch.id)

    # ------------------------------------------------------------------
    # Faculty portal access helpers
    # ------------------------------------------------------------------
    @property
    def has_resume_portal(self) -> bool:
        """Faculty may use the resume review portal."""
        return self.is_super_admin or (
            self.is_faculty and self.faculty_access in (self.FacultyAccess.RESUME, self.FacultyAccess.BOTH)
        )

    @property
    def has_placement_portal(self) -> bool:
        """Faculty may use the placement drives portal."""
        return self.is_super_admin or (
            self.is_faculty and self.faculty_access in (self.FacultyAccess.PLACEMENT, self.FacultyAccess.BOTH)
        )

    @property
    def profile_completion(self) -> int:
        """0-100 percentage of profile fields filled in (student profile card)."""
        checks = [
            bool((self.full_name or "").strip()),
            bool(self.email),
            bool((self.phone or "").strip()),
            bool(self.gender),
            bool(self.passout_year),
            bool(self.avatar_url),
            bool(getattr(self, "resume", None) and not getattr(self.resume, "is_missing", True)),
        ]
        if not checks:
            return 0
        return int(round(sum(1 for c in checks if c) / len(checks) * 100))


class Resume(models.Model):
    """A student's resume (PDF) stored on Cloudinary.

    One resume per student. Faculty see the resumes of every student in their
    branch; the owning student can upload, replace and delete their own.
    """

    student = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="resume"
    )
    file_name = models.CharField(max_length=255)
    file_size = models.PositiveBigIntegerField(default=0)  # bytes
    cloudinary_url = models.URLField(max_length=500)
    public_id = models.CharField(max_length=255)
    # Review state: faculty mark a resume as reviewed so the student can see it.
    is_reviewed = models.BooleanField(default=False)
    reviewed_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="reviewed_resumes",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    # Set when the Cloudinary file is found to be deleted; the student sees a
    # "re-upload" prompt and faculty lists hide it.
    is_missing = models.BooleanField(default=False)
    file_checked_at = models.DateTimeField(null=True, blank=True)
    # When a previously-deleted resume comes back in Cloudinary this marks
    # when, so the UI can show a "Restored" badge for a while.
    restored_at = models.DateTimeField(null=True, blank=True)
    # AI review: the student (or faculty) runs an analysis once, and the
    # results are cached here so repeated views are free. Re-running happens
    # after uploading a new version or when new drives open.
    class AiStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        COMPLETE = "COMPLETE", "Complete"
        FAILED = "FAILED", "Failed"

    ai_status = models.CharField(
        max_length=10, choices=AiStatus.choices, default=AiStatus.PENDING
    )
    ai_score = models.PositiveSmallIntegerField(null=True, blank=True)  # 0-100
    # {summary, strengths[], improvements[], skills[], ats_keywords[]}
    ai_analysis = models.JSONField(null=True, blank=True)
    # drive_id -> {score, reason, company_name} snapshot at analysis time
    ai_match = models.JSONField(null=True, blank=True)
    ai_error = models.CharField(max_length=500, blank=True, default="")
    ai_analyzed_at = models.DateTimeField(null=True, blank=True)
    # ATS report viewing gate: the full ATS report can only be opened once per
    # interval (default 10 days, admin-adjustable per student). This records
    # the last time the report was actually opened by the student.
    ats_viewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["student__roll_number"]

    def __str__(self) -> str:
        return f"Resume: {self.student.roll_number}"


class AiAccessConfig(models.Model):
    """Per-student overrides for the AI usage limits.

    Every student gets the portal-wide defaults (daily AI requests = 5,
    ATS report view interval = 10 days, resume uploads per day = 2). The
    Super Admin can adjust these for a specific roll number - raise/lower the
    numbers or grant unlimited AI requests - via the Students admin page.
    """

    student = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="ai_access"
    )
    # None => use the portal default (settings.AI_DAILY_REQUEST_LIMIT).
    daily_ai_requests = models.PositiveSmallIntegerField(null=True, blank=True)
    unlimited_ai = models.BooleanField(default=False)
    # None => use the portal default (settings.ATS_VIEW_INTERVAL_DAYS).
    ats_view_interval_days = models.PositiveSmallIntegerField(null=True, blank=True)
    # None => use the portal default (settings.RESUME_DAILY_UPLOAD_LIMIT).
    daily_resume_uploads = models.PositiveSmallIntegerField(null=True, blank=True)
    updated_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="ai_access_updates",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["student__roll_number"]

    def __str__(self) -> str:
        return f"AiAccessConfig({self.student.roll_number})"
