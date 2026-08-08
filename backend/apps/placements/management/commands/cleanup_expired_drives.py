from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.placements.models import Drive


class Command(BaseCommand):
    """Delete drives that expired more than 30 days ago.

    The same cleanup also runs lazily whenever the drives list is fetched, so
    this command is just belt-and-braces for scheduled runs (Render cron /
    a plain cron entry).
    """

    help = "Delete drives past their 30-day post-expiry grace period"

    def handle(self, *args, **options):
        cutoff = timezone.localdate() - timedelta(days=30)
        deleted, _ = Drive.objects.filter(last_date_to_apply__lt=cutoff).delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} expired drive(s)."))
