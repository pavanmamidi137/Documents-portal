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
