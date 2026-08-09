"""Cache invalidation for the aggregated /meta/ response."""

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.core.utils import invalidate_portal_caches

from .models import Branch, Category, Section, Semester, Subject


@receiver([post_save, post_delete], sender=Branch)
@receiver([post_save, post_delete], sender=Section)
@receiver([post_save, post_delete], sender=Semester)
@receiver([post_save, post_delete], sender=Category)
@receiver([post_save, post_delete], sender=Subject)
def _invalidate_meta_cache(*args, **kwargs):
    """New/edited reference rows must appear in upload forms immediately."""
    invalidate_portal_caches("meta")
