"""Cache invalidation for dashboards that surface resumes."""

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.core.utils import invalidate_portal_caches

from .models import Resume


@receiver([post_save, post_delete], sender=Resume)
def _invalidate_resume_caches(*args, **kwargs):
    """Faculty dashboards list recent resumes - keep them fresh."""
    invalidate_portal_caches("dash")
