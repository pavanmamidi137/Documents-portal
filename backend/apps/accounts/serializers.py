from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import AiAccessConfig, Resume, User, derive_passout_year


class UserSerializer(serializers.ModelSerializer):
    role_label = serializers.CharField(read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)
    branch_code = serializers.CharField(source="branch.code", read_only=True, default="")
    section_name = serializers.CharField(source="section.name", read_only=True, default=None)
    gender_label = serializers.CharField(source="get_gender_display", read_only=True, default="")
    faculty_access_label = serializers.CharField(
        source="get_faculty_access_display", read_only=True, default=""
    )

    class Meta:
        model = User
        fields = [
            "id", "roll_number", "full_name", "email", "phone", "gender",
            "gender_label", "avatar_url", "passout_year",
            "role", "role_label", "faculty_access", "faculty_access_label",
            "branch", "branch_name", "branch_code", "section", "section_name",
            "is_active", "is_staff", "is_super_admin", "is_cr", "is_faculty",
            "is_student", "profile_completion", "date_joined",
        ]
        read_only_fields = ["id", "date_joined", "is_staff", "profile_completion"]


class AdminUserSerializer(UserSerializer):
    """UserSerializer plus the primary-admin flag.

    Kept OUT of the base UserSerializer so the busiest list endpoints
    (students, faculty, search, resumes) never pay the extra query - it is
    only used where the flag matters: the auth user (login/me), the admins
    list and admin-account actions.
    """

    is_primary_admin = serializers.SerializerMethodField()

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + ["is_primary_admin"]

    def get_is_primary_admin(self, obj) -> bool:
        if not obj.is_super_admin:
            return False  # non-admins never pay the lookup query
        # DRF reuses ONE serializer instance for every row in a list response,
        # so the primary-admin lookup runs once per response, not once per row.
        primary_id = getattr(self, "_primary_admin_id", None)
        if primary_id is None:
            primary_id = (
                User.objects.filter(role=User.Role.SUPER_ADMIN)
                .order_by("date_joined", "id")
                .values_list("id", flat=True)
                .first()
                or 0  # sentinel: no admins -> cache sticks, never matches
            )
            self._primary_admin_id = primary_id
        return obj.id == primary_id


class LoginSerializer(TokenObtainPairSerializer):
    """Extends JWT login to also return the user profile.

    Roll numbers are normalized to UPPERCASE: new accounts are created with
    uppercase roll numbers, so legacy lowercase accounts are matched via a
    case-insensitive lookup before authenticating.
    """

    def validate(self, attrs):
        username = attrs.get(self.username_field)
        legacy = None
        if username:
            attrs[self.username_field] = str(username).strip().upper()
            # Legacy accounts may still be stored in lowercase - use the
            # stored casing so authenticate() finds them. The relations are
            # prefetched in the SAME query so building the profile in the
            # login response below costs zero extra DB round-trips (branch
            # and section would otherwise be fetched lazily, one query each).
            legacy = User.objects.select_related("branch", "section").filter(
                roll_number__iexact=attrs[self.username_field]
            ).first()
            if legacy:
                attrs[self.username_field] = legacy.roll_number
        data = super().validate(attrs)
        # ``self.user`` (from authenticate) and ``legacy`` point at the same
        # account row, but only ``legacy`` carries the prefetched relations -
        # reuse it so serialization stays in memory and skips 2 queries.
        if legacy is not None:
            self.user = legacy
        # AdminUserSerializer so admins immediately know (and the frontend can
        # gate) whether they are the primary admin.
        data["user"] = AdminUserSerializer(self.user).data
        return data


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(min_length=6, trim_whitespace=False)

    def validate_old_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value):
        if value == self.initial_data.get("old_password"):
            raise serializers.ValidationError("New password must differ from the current password.")
        return value


class ResetPasswordSerializer(serializers.Serializer):
    new_password = serializers.CharField(min_length=6, trim_whitespace=False)


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """Users editing their own contact details (branch/section stay fixed).

    Super Admins may also change their own username (roll number); for every
    other role the roll number is read-only and any attempt to change it is
    rejected.
    """

    class Meta:
        model = User
        fields = ["roll_number", "full_name", "email", "phone", "gender", "passout_year"]

    def validate_roll_number(self, value):
        request = self.context.get("request")
        if not request or not request.user.is_super_admin:
            raise serializers.ValidationError(
                "Only admins can change their username."
            )
        value = value.strip().upper()
        if not value:
            raise serializers.ValidationError("Username cannot be empty.")
        qs = User.objects.filter(roll_number=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This username is already in use.")
        return value

    def validate_passout_year(self, value):
        if value is None:
            return None
        if not (1980 <= value <= 2100):
            raise serializers.ValidationError("Enter a valid pass-out year.")
        return value

    def validate_full_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Name cannot be empty.")
        return value

    def validate_email(self, value):
        value = (value or "").strip().lower()
        if not value:
            return None
        qs = User.objects.filter(email=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This email is already in use.")
        return value


class StudentCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = [
            "id", "roll_number", "full_name", "email", "phone", "gender",
            "passout_year", "branch", "section", "password", "is_active",
        ]
        read_only_fields = ["id"]

    def validate_roll_number(self, value):
        # Roll numbers are always stored in UPPERCASE.
        value = value.strip().upper()
        if User.objects.filter(roll_number=value).exists():
            raise serializers.ValidationError("A student with this roll number already exists.")
        return value

    def validate_email(self, value):
        if value and User.objects.filter(email=value).exists():
            raise serializers.ValidationError("A student with this email already exists.")
        return value

    def validate_passout_year(self, value):
        if value is not None and not (1990 <= int(value) <= 2100):
            raise serializers.ValidationError("Enter a valid pass-out year.")
        return value

    def validate(self, attrs):
        user = self.context["request"].user
        # CRs may only create students inside their own section.
        if user.is_cr:
            attrs["role"] = User.Role.STUDENT
            attrs["branch"] = user.branch
            attrs["section"] = user.section
        else:
            attrs.setdefault("role", User.Role.STUDENT)
            if not attrs.get("branch"):
                raise serializers.ValidationError({"branch": "Branch is required."})
            if not attrs.get("section"):
                raise serializers.ValidationError({"section": "Section is required."})
        return attrs

    def create(self, validated_data):
        roll_number = validated_data.pop("roll_number")
        # Default password is the student's roll number (in capitals).
        password = validated_data.pop("password", None) or roll_number
        # Batch/pass-out year defaults from the roll number when not provided.
        passout_year = (
            validated_data.pop("passout_year", None) or derive_passout_year(roll_number)
        )
        return User.objects.create_user(
            roll_number, password, passout_year=passout_year, **validated_data
        )


class StudentUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id", "full_name", "email", "phone", "gender", "passout_year",
            "branch", "section", "is_active",
        ]
        read_only_fields = ["id", "role"]

    def validate_passout_year(self, value):
        if value is not None and not (1990 <= int(value) <= 2100):
            raise serializers.ValidationError("Enter a valid pass-out year.")
        return value

    def validate(self, attrs):
        user = self.context["request"].user
        if user.is_cr:
            # CR cannot move students across branches/sections, and cannot
            # activate/deactivate them (reserved for the Super Admin).
            attrs.pop("branch", None)
            attrs.pop("section", None)
            attrs.pop("is_active", None)
        return attrs


class AdminCreateSerializer(serializers.ModelSerializer):
    """Super Admin creates another admin account (default password = roll number)."""

    password = serializers.CharField(write_only=True, min_length=6, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = [
            "id", "roll_number", "full_name", "email", "phone",
            "password", "is_active",
        ]
        read_only_fields = ["id"]

    def validate_roll_number(self, value):
        value = value.strip().upper()
        if User.objects.filter(roll_number=value).exists():
            raise serializers.ValidationError("A user with this roll number already exists.")
        return value

    def validate_email(self, value):
        value = (value or "").strip().lower()
        if not value:
            return None
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate(self, attrs):
        attrs["role"] = User.Role.SUPER_ADMIN
        return attrs

    def create(self, validated_data):
        roll_number = validated_data.pop("roll_number")
        password = validated_data.pop("password", None) or roll_number
        # Match create_superuser: new admins also get Django admin access.
        return User.objects.create_user(
            roll_number, password, **validated_data,
            is_staff=True, is_superuser=True,
        )


class FacultyCreateSerializer(serializers.ModelSerializer):
    """Admin creates a faculty account (roll number + branch + default password)."""

    password = serializers.CharField(write_only=True, min_length=6, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = [
            "id", "roll_number", "full_name", "email", "phone",
            "branch", "faculty_access", "password", "is_active",
        ]
        read_only_fields = ["id"]

    def validate_roll_number(self, value):
        value = value.strip().upper()
        if User.objects.filter(roll_number=value).exists():
            raise serializers.ValidationError("A user with this roll number already exists.")
        return value

    def validate_email(self, value):
        if value and User.objects.filter(email=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate(self, attrs):
        attrs["role"] = User.Role.FACULTY
        if not attrs.get("branch"):
            raise serializers.ValidationError({"branch": "Assign a branch to this faculty member."})
        return attrs

    def create(self, validated_data):
        roll_number = validated_data.pop("roll_number")
        password = validated_data.pop("password", None) or roll_number
        return User.objects.create_user(roll_number, password, **validated_data)


class FacultyUpdateSerializer(serializers.ModelSerializer):
    """Admin edits a faculty member (username/roll number editable too)."""

    password = serializers.CharField(write_only=True, min_length=6, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = [
            "id", "roll_number", "full_name", "email", "phone", "branch",
            "faculty_access", "is_active", "password",
        ]
        read_only_fields = ["id", "role"]

    def validate_roll_number(self, value):
        value = value.strip().upper()
        if not value:
            raise serializers.ValidationError("Username cannot be empty.")
        qs = User.objects.filter(roll_number=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This username is already in use.")
        return value

    def validate_email(self, value):
        value = (value or "").strip().lower()
        if not value:
            return None
        qs = User.objects.filter(email=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This email is already in use.")
        return value


class ResumeSerializer(serializers.ModelSerializer):
    student_roll = serializers.CharField(source="student.roll_number", read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    student_avatar_url = serializers.CharField(source="student.avatar_url", read_only=True)
    student_gender_label = serializers.CharField(
        source="student.get_gender_display", read_only=True, default=""
    )
    branch_name = serializers.CharField(source="student.branch.name", read_only=True, default=None)
    branch_code = serializers.CharField(
        source="student.branch.code", read_only=True, default=""
    )
    section_name = serializers.CharField(source="student.section.name", read_only=True, default=None)
    reviewed_by_name = serializers.CharField(
        source="reviewed_by.full_name", read_only=True, default=None
    )
    ats_viewed_at = serializers.DateTimeField(read_only=True)

    class Meta:
        model = Resume
        fields = [
            "id", "student", "student_roll", "student_name", "student_avatar_url",
            "student_gender_label",
            "branch_name", "branch_code", "section_name",
            "file_name", "file_size", "cloudinary_url",
            "is_reviewed", "reviewed_by_name", "reviewed_at",
            "is_missing", "restored_at",
            "ai_status", "ai_score", "ai_analysis", "ai_match", "ai_error",
            "ai_analyzed_at", "ats_viewed_at", "created_at", "updated_at",
        ]
        read_only_fields = fields


class AiAccessConfigSerializer(serializers.ModelSerializer):
    """Super Admin view/edit of a student's AI usage limits."""

    class Meta:
        model = AiAccessConfig
        fields = [
            "id", "student", "daily_ai_requests", "unlimited_ai",
            "ats_view_interval_days", "daily_resume_uploads", "updated_at",
        ]
        read_only_fields = ["id", "student", "updated_at"]
