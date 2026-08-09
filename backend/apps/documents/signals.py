"""Cache invalidation for document listings and dashboards."""

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.core.utils import invalidate_portal_caches

from .models import Document


@receiver([post_save, post_delete], sender=Document)
def _invalidate_document_caches(*args, **kwargs):
    """Uploads/deletions must show up in trees and dashboards right away."""
    invalidate_portal_caches("tree", "dash")
