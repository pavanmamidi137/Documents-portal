from rest_framework import serializers

from .models import AuditLog


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
