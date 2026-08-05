from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ["action", "actor", "target_type", "target_id", "created_at"]
    list_filter = ["action", "created_at"]
    search_fields = ["actor__roll_number", "actor__full_name", "target_type", "target_id"]
    readonly_fields = [f.name for f in AuditLog._meta.fields]
