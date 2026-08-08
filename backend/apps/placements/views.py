from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import permissions
from rest_framework.viewsets import ModelViewSet

from apps.core.models import Notification
from apps.core.utils import log_audit, notify

from .models import Drive
from .serializers import DriveSerializer

User = get_user_model()

# Admins, faculty and CRs may post/manage drives; students only read.
_WRITE_ROLES = {User.Role.SUPER_ADMIN, User.Role.FACULTY, User.Role.CR}


class _CanWriteDrives(permissions.BasePermission):
    """Authenticated users may read drives; only admins/faculty/CRs may write."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return user.role in _WRITE_ROLES


def _drive_recipients():
    """All active students - they are the ones applying to drives."""
    return User.objects.filter(is_active=True, role=User.Role.STUDENT)


def _drive_preview(instance) -> str:
    line = instance.role or instance.location or ""
    preview = instance.company_name
    if line:
        preview += f" · {line}"
    if instance.package:
        preview += f" · {instance.package}"
    # Keep well under the Notification.message (max_length=500) cap.
    return preview[:300]


class DriveViewSet(ModelViewSet):
    """Placement drives. Open drives expire at the last date to apply and are
    hard-deleted 30 days after expiry."""

    serializer_class = DriveSerializer
    permission_classes = [_CanWriteDrives]
    # Drives are a small, curated list - no pagination wrapper for the tabs.
    pagination_class = None

    def get_queryset(self):
        # Lazy cleanup: drop anything past its 30-day grace period.
        cutoff = timezone.localdate() - timedelta(days=30)
        Drive.objects.filter(last_date_to_apply__lt=cutoff).delete()

        qs = Drive.objects.select_related("posted_by").all()
        # Only the list tab filters by status - detail/update/delete must see
        # every drive regardless of its current status.
        if self.action == "list":
            drive_status = (self.request.query_params.get("status") or "open").lower()
            today = timezone.localdate()
            if drive_status == "open":
                qs = qs.filter(last_date_to_apply__gte=today)
            elif drive_status == "expired":
                qs = qs.filter(last_date_to_apply__lt=today)
        return qs

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        user = request.user
        if request.method in ("PUT", "PATCH", "DELETE"):
            # Only the poster or a super admin may edit/delete a drive.
            if not (user.is_super_admin or obj.posted_by_id == user.id):
                self.permission_denied(
                    request,
                    message="You can only edit or delete drives you posted.",
                )

    def perform_create(self, serializer):
        instance = serializer.save(posted_by=self.request.user)
        log_audit(
            self.request.user, "CREATE", "Drive", instance.id,
            {"company_name": instance.company_name, "role": instance.role},
            self.request,
        )
        notify(
            _drive_recipients(),
            Notification.Kind.DRIVE,
            f"New drive: {instance.company_name}",
            _drive_preview(instance),
            "/placements",
        )

    def perform_update(self, serializer):
        instance = serializer.save()
        log_audit(
            self.request.user, "UPDATE", "Drive", instance.id,
            {"company_name": instance.company_name}, self.request,
        )

    def perform_destroy(self, instance):
        log_audit(
            self.request.user, "DELETE", "Drive", instance.id,
            {"company_name": instance.company_name}, self.request,
        )
        instance.delete()
