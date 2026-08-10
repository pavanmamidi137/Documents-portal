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

    class JobType(models.TextChoices):
        JOB = "JOB", "Job"
        INTERNSHIP = "INTERNSHIP", "Internship"

    company_name = models.CharField(max_length=150)
    job_type = models.CharField(
        max_length=20, choices=JobType.choices, blank=True, default="",
        help_text="Job or Internship (blank = not specified)",
    )
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
    # Optional: a drive without a last date stays OPEN (no auto-expiry).
    last_date_to_apply = models.DateField(null=True, blank=True)
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
        if not self.last_date_to_apply:
            return False  # no deadline -> never expires
        return self.last_date_to_apply < timezone.localdate()

    @property
    def status(self) -> str:
        return "EXPIRED" if self.is_expired else "OPEN"

    @property
    def expires_at(self):
        """The date the drive is hard-deleted (30 days after the last date)."""
        if not self.last_date_to_apply:
            return None
        return self.last_date_to_apply + timedelta(days=30)

    def eligible_rolls(self) -> set[str]:
        # Excel pastes may use commas, tabs, newlines, spaces or semicolons,
        # and CSV exports sometimes start with a UTF-8 BOM.
        return {
            r.strip().strip("\ufeff").upper()
            for r in re.split(r"[,\s;]+", self.eligible_roll_numbers)
            if r.strip()
        }


class DriveChatMessage(models.Model):
    """One saved Q&A exchange between a student and the per-drive AI assistant.

    The whole conversation for a drive is kept (scoped to the student) so it
    stays visible even after the drive expires - the chat belongs to that
    specific drive and is never mixed with other drives.
    """

    class Role(models.TextChoices):
        USER = "user", "Student"
        ASSISTANT = "assistant", "Placement AI"

    drive = models.ForeignKey(
        Drive, on_delete=models.CASCADE, related_name="chat_messages"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="drive_chat_messages",
    )
    role = models.CharField(max_length=10, choices=Role.choices)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["drive", "user"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} on drive {self.drive_id}: {self.content[:40]}"


class AiUsageLog(models.Model):
    """One row per AI call, so the super admin can see who uses how many
    AI credits (tokens)."""

    class Action(models.TextChoices):
        EXTRACT = "AI_EXTRACT", "AI Extract"
        CHAT = "AI_CHAT", "AI Chat"
        ASK = "AI_ASK", "AI Ask"
        RESUME = "AI_RESUME", "AI Resume Review"
        DOC_OCR = "AI_DOC_OCR", "Document OCR"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ai_usage_logs",
    )
    action = models.CharField(max_length=20, choices=Action.choices)
    prompt_tokens = models.PositiveIntegerField(default=0)
    completion_tokens = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def __str__(self) -> str:
        return f"[{self.action}] {self.user_id} {self.total_tokens}t"
