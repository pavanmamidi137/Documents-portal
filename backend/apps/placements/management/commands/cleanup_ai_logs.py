"""Delete AI request log rows older than the retention window (default 30 days).

The same cleanup is available on the AI Management > Usage page via the
"Clear logs older than 30 days" button. This command is belt-and-braces for
scheduled runs (Render cron / a plain cron entry) so the log never grows
forever.

Usage:
    python manage.py cleanup_ai_logs
    python manage.py cleanup_ai_logs --days 60
"""

from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.placements.ai_models import AIRequestLog


class Command(BaseCommand):
    help = "Delete AI request log rows older than AI_LOG_RETENTION_DAYS (default 30)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--days", type=int, default=None,
            help="Retention window in days (default: the AI_LOG_RETENTION_DAYS setting).",
        )

    def handle(self, *args, **options):
        days = (
            options["days"]
            if options["days"] is not None
            else getattr(settings, "AI_LOG_RETENTION_DAYS", 30)
        )
        cutoff = timezone.now() - timedelta(days=days)
        deleted, _ = AIRequestLog.objects.filter(created_at__lt=cutoff).delete()
        self.stdout.write(
            self.style.SUCCESS(
                f"Deleted {deleted} AI request log row(s) older than {days} day(s)."
            )
        )
