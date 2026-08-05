from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models


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
        STUDENT = "STUDENT", "Student"

    roll_number = models.CharField(max_length=30, unique=True)
    full_name = models.CharField(max_length=150)
    email = models.EmailField(unique=True, null=True, blank=True)
    phone = models.CharField(max_length=20, blank=True, default="")
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
    def is_student(self) -> bool:
        return self.role == self.Role.STUDENT

    @property
    def role_label(self) -> str:
        return self.Role(self.role).label if self.role in self.Role.values else self.role

    def can_manage_section(self, section) -> bool:
        """Super admins manage everything; CRs only their assigned section."""
        if self.is_super_admin:
            return True
        return bool(self.is_cr and section and self.section_id == section.id)
