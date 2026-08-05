from django.conf import settings
from django.db import models


class Document(models.Model):
    """A PDF stored in Cloudinary - the database only keeps references."""

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    file_name = models.CharField(max_length=255)
    file_size = models.PositiveBigIntegerField(default=0)  # bytes
    cloudinary_url = models.URLField(max_length=500)
    public_id = models.CharField(max_length=255, unique=True)
    downloads = models.PositiveIntegerField(default=0)

    branch = models.ForeignKey(
        "college.Branch", on_delete=models.PROTECT, related_name="documents"
    )
    section = models.ForeignKey(
        "college.Section", on_delete=models.PROTECT, related_name="documents"
    )
    semester = models.ForeignKey(
        "college.Semester", on_delete=models.PROTECT, related_name="documents"
    )
    category = models.ForeignKey(
        "college.Category", on_delete=models.PROTECT, related_name="documents"
    )
    subject = models.ForeignKey(
        "college.Subject", on_delete=models.PROTECT, related_name="documents"
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="documents",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["branch", "section"]),
            models.Index(fields=["semester", "category"]),
            models.Index(fields=["subject"]),
        ]

    def __str__(self) -> str:
        return self.title

    @property
    def download_url(self) -> str:
        """Cloudinary URL flagged to force browser download."""
        return self.cloudinary_url.replace("/raw/upload/", "/raw/upload/fl_attachment/", 1)
