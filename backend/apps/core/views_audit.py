from rest_framework.viewsets import ReadOnlyModelViewSet

from .models import AuditLog
from .permissions import IsSuperAdmin
from .serializers import AuditLogSerializer


class AuditLogViewSet(ReadOnlyModelViewSet):
    """Audit trail - Super Admin only."""

    queryset = AuditLog.objects.select_related("actor").all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsSuperAdmin]
    search_fields = ["target_type", "target_id", "actor__full_name", "actor__roll_number"]
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]
