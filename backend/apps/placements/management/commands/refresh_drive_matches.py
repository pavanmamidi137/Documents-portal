"""Re-run the AI drive-match refresh across analyzed resumes.

Normally each new drive post triggers an automatic background refresh. This
command lets an admin catch up after e.g. a long outage or a batch of drives
posted before the feature shipped.

Cost: one small AI call per analyzed resume (capped at AI_REFRESH_BATCH_SIZE),
covering every open drive - NOT one call per drive, so it stays cheap.
"""

from django.core.management.base import BaseCommand

from apps.accounts.models import User
from apps.placements.resume_ai import refresh_all_matches


class Command(BaseCommand):
    help = (
        "Recompute AI drive matches for analyzed resumes across all open "
        "drives (one AI call per resume)."
    )

    def handle(self, *args, **options):
        actor = (
            User.objects.filter(role=User.Role.SUPER_ADMIN, is_active=True)
            .order_by("id")
            .first()
        )
        updated = refresh_all_matches(actor)
        self.stdout.write(
            self.style.SUCCESS(
                f"Refreshed drive matches for {updated} resume(s)."
            )
        )
