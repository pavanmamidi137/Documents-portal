from rest_framework import serializers

from .models import AuditLog, ContactRequest, Feedback, Notification


class AuditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()
    actor_roll = serializers.CharField(source="actor.roll_number", read_only=True, default="")

    class Meta:
        model = AuditLog
        fields = [
            "id", "actor", "actor_name", "actor_roll", "action", "target_type",
            "target_id", "details", "ip_address", "created_at",
        ]
        read_only_fields = fields

    def get_actor_name(self, obj) -> str:
        return obj.actor.full_name if obj.actor else "System"


class NotificationSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    created_at = serializers.DateTimeField(read_only=True)

    class Meta:
        model = Notification
        fields = ["id", "kind", "kind_label", "title", "message", "link", "read", "created_at"]
        read_only_fields = fields


class ContactRequestSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source="sender.full_name", read_only=True, default="")
    sender_roll = serializers.CharField(source="sender.roll_number", read_only=True, default="")
    sender_role = serializers.CharField(source="sender.role_label", read_only=True, default="")
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = ContactRequest
        fields = [
            "id", "sender", "sender_name", "sender_roll", "sender_role",
            "subject", "message", "status", "status_label", "created_at", "resolved_at",
        ]
        read_only_fields = [
            "id", "sender", "sender_name", "sender_roll", "sender_role",
            "status", "status_label", "created_at", "resolved_at",
        ]


class FeedbackSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.full_name", read_only=True, default="")
    user_roll = serializers.CharField(source="user.roll_number", read_only=True, default="")
    user_role = serializers.CharField(source="user.role_label", read_only=True, default="")
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Feedback
        fields = [
            "id", "user", "user_name", "user_roll", "user_role",
            "kind", "kind_label", "title", "message",
            "status", "status_label", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "user", "user_name", "user_roll", "user_role",
            "kind", "kind_label", "status", "status_label", "created_at", "updated_at",
        ]
