"""Lifecycle signals for placement drives."""

from django.db.models.signals import post_delete
from django.dispatch import receiver

from apps.core.models import Notification

from .models import Drive


@receiver(post_delete, sender=Drive)
def _cleanup_drive_notifications(sender, instance, **kwargs):
    """Drop every notification that pointed at the deleted drive.

    When a drive is removed (manually, via the lazy expiry cleanup, or the
    cleanup_expired_drives command) its bell notifications become dead links -
    students would tap a notification that opens a missing drive. The drive
    notifications are created with a ``link`` of ``/placements/{id}``, so a
    kind + link match removes exactly those rows and nothing else.
    """
    try:
        Notification.objects.filter(
            kind=Notification.Kind.DRIVE,
            link=f"/placements/{instance.pk}",
        ).delete()
    except Exception:  # pragma: no cover - cleanup must never break deletion
        pass
