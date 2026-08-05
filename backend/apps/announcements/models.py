from django.conf import settings
from django.db import models


class Announcement(models.Model):
    class Visibility(models.TextChoices):
        COLLEGE = "COLLEGE", "Entire College"
        BRANCH = "BRANCH", "Branch Only"
        SECTION = "SECTION", "Section Only"
        CR_ONLY = "CR_ONLY", "CR Only"
        STUDENT_ONLY = "STUDENT_ONLY", "Student Only"

    title = models.CharField(max_length=200)
    body = models.TextField()
    visibility = models.CharField(
        max_length=20, choices=Visibility.choices, default=Visibility.COLLEGE
    )
    branch = models.ForeignKey(
        "college.Branch", null=True, blank=True, on_delete=models.CASCADE,
        related_name="announcements",
    )
    section = models.ForeignKey(
        "college.Section", null=True, blank=True, on_delete=models.CASCADE,
        related_name="announcements",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL,
        related_name="announcements",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title

    @property
    def visibility_label(self) -> str:
        return self.Visibility(self.visibility).label
