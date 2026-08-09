from django.conf import settings
from django.db import models


class SiteSetting(models.Model):
    """Small key/value store for site-wide settings (e.g. the portal theme)."""

    key = models.CharField(max_length=60, unique=True)
    value = models.CharField(max_length=120, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["key"]

    def __str__(self) -> str:
        return f"{self.key} = {self.value}"


class AuditLog(models.Model):
    """Immutable audit trail for security-sensitive actions."""

    class Action(models.TextChoices):
        CREATE = "CREATE", "Create"
        UPDATE = "UPDATE", "Update"
        DELETE = "DELETE", "Delete"
        LOGIN = "LOGIN", "Login"
        LOGOUT = "LOGOUT", "Logout"
        PROMOTE = "PROMOTE", "Promote to CR"
        DEMOTE = "DEMOTE", "Demote to Student"
        ACTIVATE = "ACTIVATE", "Activate"
        DEACTIVATE = "DEACTIVATE", "Deactivate"
        PASSWORD_RESET = "PASSWORD_RESET", "Password Reset"
        CSV_IMPORT = "CSV_IMPORT", "CSV Import"
        CSV_EXPORT = "CSV_EXPORT", "CSV Export"
        DOCUMENT_UPLOAD = "DOCUMENT_UPLOAD", "Document Upload"
        DOCUMENT_DELETE = "DOCUMENT_DELETE", "Document Delete"
        DOCUMENT_DOWNLOAD = "DOCUMENT_DOWNLOAD", "Document Download"
        DOCUMENT_SHARE = "DOCUMENT_SHARE", "Document Shared"
        DOCUMENT_FORK = "DOCUMENT_FORK", "Document Forked"

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_logs",
    )
    action = models.CharField(max_length=30, choices=Action.choices)
    target_type = models.CharField(max_length=60, blank=True, default="")
    target_id = models.CharField(max_length=60, blank=True, default="")
    details = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "Audit logs"

    def __str__(self) -> str:
        return f"[{self.action}] {self.target_type} {self.target_id} by {self.actor}"


class Notification(models.Model):
    """Per-user in-app notification (bell icon in the top bar).

    Created on document uploads (students/CRs of the target section), resume
    uploads (faculty of the branch) and contact-admin requests (admins).
    """

    class Kind(models.TextChoices):
        DOCUMENT_UPLOAD = "DOCUMENT_UPLOAD", "Document Upload"
        RESUME_UPLOAD = "RESUME_UPLOAD", "Resume Upload"
        CONTACT_ADMIN = "CONTACT_ADMIN", "Contact Admin"
        ANNOUNCEMENT = "ANNOUNCEMENT", "Announcement"
        DRIVE = "DRIVE", "Placement Drive"
        AI_RESUME = "AI_RESUME", "AI Resume Review"
        AI_REPORT = "AI_REPORT", "AI Health Report"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    kind = models.CharField(max_length=30, choices=Kind.choices)
    title = models.CharField(max_length=200)
    message = models.CharField(max_length=500)
    # Frontend route the notification links to (e.g. "/documents").
    link = models.CharField(max_length=200, blank=True, default="")
    read = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"[{self.kind}] {self.title} -> {self.user}"


class ContactRequest(models.Model):
    """Faculty/CR message to the admin (the "approach admin" system).

    Sending a request notifies every admin; the admin can then resolve it.
    """

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        RESOLVED = "RESOLVED", "Resolved"

    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="contact_requests",
    )
    subject = models.CharField(max_length=150)
    message = models.TextField()
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.subject} by {self.sender}"
