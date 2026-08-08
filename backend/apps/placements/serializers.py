from rest_framework import serializers

from .models import Drive


class DriveSerializer(serializers.ModelSerializer):
    posted_by_name = serializers.CharField(source="posted_by.full_name", read_only=True, default=None)
    posted_by_role = serializers.CharField(source="posted_by.role", read_only=True, default=None)
    status = serializers.CharField(read_only=True)
    expires_at = serializers.DateField(read_only=True)
    # None for non-students, True/False for a student whose roll number is in
    # the drive's eligible list.
    is_eligible_for_me = serializers.SerializerMethodField()

    class Meta:
        model = Drive
        fields = [
            "id", "company_name", "role", "location", "package", "drive_link",
            "description", "eligibility", "eligible_roll_numbers",
            "last_date_to_apply", "posted_by", "posted_by_name", "posted_by_role",
            "status", "expires_at", "is_eligible_for_me", "created_at", "updated_at",
        ]
        read_only_fields = ["posted_by", "created_at", "updated_at"]

    def get_is_eligible_for_me(self, obj):
        user = self.context["request"].user
        if user and user.is_student and user.roll_number:
            return user.roll_number.strip().upper() in obj.eligible_rolls()
        return None
