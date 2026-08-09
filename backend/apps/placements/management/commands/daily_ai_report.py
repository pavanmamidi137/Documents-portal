"""Send the automatic daily AI health report to every Super Admin.

Schedule it once a day, e.g. a cron entry on the Render host:

    0 8 * * * cd /opt/render/project/src/backend && .venv/bin/python manage.py daily_ai_report

or Render's built-in Cron Jobs (add this as a scheduled job and call the same
command in the backend service's shell).
"""

from django.core.management.base import BaseCommand

from apps.placements.ai_report import notify_admins_daily_report


class Command(BaseCommand):
    help = "Notify all Super Admins with yesterday's AI provider health report"

    def add_arguments(self, parser):
        parser.add_argument(
            "--days", type=int, default=1,
            help="How many days of AI usage to summarise (default 1 = last 24h).",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Print the report summary instead of sending notifications.",
        )

    def handle(self, *args, **options):
        days = max(1, options["days"])
        report = build_report(days)
        if not report:
            self.stdout.write("No AI activity in the report window - nothing sent.")
            return
        summary = summarize(report)
        if options["dry_run"]:
            self.stdout.write(summary)
            return
        sent = notify_admins_daily_report(report)
        self.stdout.write(
            self.style.SUCCESS(
                f"AI health report sent to {sent} admin(s).\n{summary}"
            )
        )


def build_report(days: int):
    from apps.placements.ai_report import build_daily_report

    return build_daily_report(days=days)


def summarize(report: dict) -> str:
    from apps.placements.ai_report import _summary_line

    return _summary_line(report)
