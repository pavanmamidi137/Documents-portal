import re
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone


class Drive(models.Model):
    """A placement/company drive posted by the admin, faculty or a CR.

    Lifecycle (as required by the college):
      - OPEN      while today <= last_date_to_apply (students can apply).
      - EXPIRED   once last_date_to_apply passes; the drive stays visible on
                  the Expired tab for 30 more days showing when it will be
                  removed.
      - DELETED   automatically 30 days after expiry (lazy cleanup on list +
                  the ``cleanup_expired_drives`` management command).
    """

    company_name = models.CharField(max_length=150)
    role = models.CharField(max_length=150, blank=True, default="")
    location = models.CharField(max_length=150, blank=True, default="")
    package = models.CharField(
        max_length=100, blank=True, default="",
        help_text="CTC / stipend (free text, e.g. '6-8 LPA')",
    )
    drive_link = models.URLField(
        blank=True, default="", help_text="Link where students apply"
    )
    description = models.TextField(blank=True, default="")
    eligibility = models.TextField(
        blank=True, default="",
        help_text="Eligibility criteria shown to students",
    )
    eligible_roll_numbers = models.TextField(
        blank=True, default="",
        help_text="Optional: comma/newline-separated roll numbers (paste from an Excel sheet). "
                  "Students in the list get an 'Eligible for you' tag.",
    )
    last_date_to_apply = models.DateField()
    posted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.SET_NULL,
        related_name="posted_drives",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "drives"

    def __str__(self) -> str:
        return self.company_name

    @property
    def is_expired(self) -> bool:
        return self.last_date_to_apply < timezone.localdate()

    @property
    def status(self) -> str:
        return "EXPIRED" if self.is_expired else "OPEN"

    @property
    def expires_at(self):
        """The date the drive is hard-deleted (30 days after the last date)."""
        return self.last_date_to_apply + timedelta(days=30)

    def eligible_rolls(self) -> set[str]:
        # Excel pastes may use commas, tabs, newlines, spaces or semicolons,
        # and CSV exports sometimes start with a UTF-8 BOM.
        return {
            r.strip().strip("\ufeff").upper()
            for r in re.split(r"[,\s;]+", self.eligible_roll_numbers)
            if r.strip()
        }
