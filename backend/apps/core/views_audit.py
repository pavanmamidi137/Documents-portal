from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from .models import AuditLog
from .permissions import IsSuperAdmin
from .serializers import AuditLogSerializer
from .utils import log_audit


class AuditLogViewSet(ReadOnlyModelViewSet):
    """Audit trail - Super Admin only."""

    queryset = AuditLog.objects.select_related("actor").all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsSuperAdmin]
    search_fields = ["target_type", "target_id", "actor__full_name", "actor__roll_number"]
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]

    @action(detail=False, methods=["post"])
    def clear(self, request):
        """Clear selected log entries, or the entire log with `{"all": true}`."""
        ids = request.data.get("ids")
        if isinstance(ids, list) and ids:
            safe_ids = [int(i) for i in ids if str(i).lstrip("-").isdigit()]
            if not safe_ids:
                raise ValidationError({"ids": "No valid ids provided."})
            deleted = AuditLog.objects.filter(id__in=safe_ids).delete()[0]
            mode = "selected"
        elif request.data.get("all"):
            deleted = AuditLog.objects.all().delete()[0]
            mode = "all"
        else:
            raise ValidationError(
                {"detail": 'Provide "ids" (list) or "all": true to clear logs.'}
            )
        # The clear action itself is recorded afterwards so it survives the wipe.
        log_audit(request.user, "DELETE", "AuditLog", "",
                  {"deleted": deleted, "mode": mode}, request)
        return Response({"deleted": deleted, "mode": mode})
