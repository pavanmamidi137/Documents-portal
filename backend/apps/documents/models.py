from django.conf import settings
from django.db import models


class Document(models.Model):
    """A document stored in Cloudinary - the database only keeps references.

    One uploaded file can be shared to several sections: each section gets its
    own Document row pointing at the same Cloudinary file (same ``public_id``).
    A row created by a CR from another section's file is a "fork" and keeps a
    ``forked_from`` pointer to its source.
    """

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    file_name = models.CharField(max_length=255)
    file_size = models.PositiveBigIntegerField(default=0)  # bytes
    cloudinary_url = models.URLField(max_length=500)
    public_id = models.CharField(max_length=255)
    downloads = models.PositiveIntegerField(default=0)

    branch = models.ForeignKey(
        "college.Branch", on_delete=models.PROTECT, related_name="documents"
    )
    section = models.ForeignKey(
        "college.Section", on_delete=models.PROTECT, related_name="documents"
    )
    forked_from = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="forks",
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


class DocumentShareRequest(models.Model):
    """A CR (or admin) requests that another section's CR accept a document.

    Sharing stays storage-friendly: the file itself is never re-uploaded. When
    the target section's CR accepts, a Document row pointing at the same
    Cloudinary file is created in their section so their students can access it.
    """

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        ACCEPTED = "ACCEPTED", "Accepted"
        DECLINED = "DECLINED", "Declined"

    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name="share_requests"
    )
    from_section = models.ForeignKey(
        "college.Section", on_delete=models.CASCADE, related_name="sent_share_requests"
    )
    to_section = models.ForeignKey(
        "college.Section",
        on_delete=models.CASCADE,
        related_name="received_share_requests",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_share_requests",
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    note = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.document.title} → {self.to_section} ({self.status})"
