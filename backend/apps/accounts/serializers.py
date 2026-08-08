from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import Resume, User


class UserSerializer(serializers.ModelSerializer):
    role_label = serializers.CharField(read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)
    section_name = serializers.CharField(source="section.name", read_only=True, default=None)

    class Meta:
        model = User
        fields = [
            "id", "roll_number", "full_name", "email", "phone", "role", "role_label",
            "branch", "branch_name", "section", "section_name",
            "is_active", "is_staff", "is_super_admin", "is_cr", "is_faculty",
            "is_student", "date_joined",
        ]
        read_only_fields = ["id", "date_joined", "is_staff"]


class LoginSerializer(TokenObtainPairSerializer):
    """Extends JWT login to also return the user profile.

    Roll numbers are normalized to UPPERCASE: new accounts are created with
    uppercase roll numbers, so legacy lowercase accounts are matched via a
    case-insensitive lookup before authenticating.
    """

    def validate(self, attrs):
        username = attrs.get(self.username_field)
        if username:
            attrs[self.username_field] = str(username).strip().upper()
            # Legacy accounts may still be stored in lowercase - use the
            # stored casing so authenticate() finds them.
            legacy = User.objects.filter(
                roll_number__iexact=attrs[self.username_field]
            ).first()
            if legacy:
                attrs[self.username_field] = legacy.roll_number
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
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
    """Users editing their own contact details (roll/branch/section stay fixed)."""

    class Meta:
        model = User
        fields = ["full_name", "email", "phone"]

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
            "id", "roll_number", "full_name", "email", "phone",
            "branch", "section", "password", "is_active",
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
        return User.objects.create_user(
            roll_number, password, **validated_data
        )


class StudentUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "full_name", "email", "phone", "branch", "section", "is_active"]
        read_only_fields = ["id", "role"]

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
            "branch", "password", "is_active",
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
    """Admin edits a faculty member (identity fields stay fixed)."""

    password = serializers.CharField(write_only=True, min_length=6, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ["id", "full_name", "email", "phone", "branch", "is_active", "password"]
        read_only_fields = ["id", "role"]

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
    branch_name = serializers.CharField(source="student.branch.name", read_only=True, default=None)
    section_name = serializers.CharField(source="student.section.name", read_only=True, default=None)
    reviewed_by_name = serializers.CharField(
        source="reviewed_by.full_name", read_only=True, default=None
    )

    class Meta:
        model = Resume
        fields = [
            "id", "student", "student_roll", "student_name",
            "branch_name", "section_name",
            "file_name", "file_size", "cloudinary_url",
            "is_reviewed", "reviewed_by_name", "reviewed_at",
            "is_missing", "restored_at", "created_at", "updated_at",
        ]
        read_only_fields = fields
