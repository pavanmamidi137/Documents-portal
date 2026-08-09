from django.contrib import admin

from .ai_models import (
    AIProvider,
    AIProviderHealth,
    AIProviderKey,
    AIRequestLog,
    AISettings,
    AITaskConfiguration,
)
from .models import Drive


@admin.register(Drive)
class DriveAdmin(admin.ModelAdmin):
    list_display = ("company_name", "role", "last_date_to_apply", "posted_by", "created_at")
    list_filter = ("last_date_to_apply",)
    search_fields = ("company_name", "role", "eligible_roll_numbers")


@admin.register(AIProvider)
class AIProviderAdmin(admin.ModelAdmin):
    list_display = ("name", "provider_type", "model", "priority", "enabled", "health")
    list_filter = ("provider_type", "enabled", "health")
    search_fields = ("name", "model")
    exclude = ("encrypted_api_key",)  # never expose raw keys in the admin


@admin.register(AIProviderKey)
class AIProviderKeyAdmin(admin.ModelAdmin):
    list_display = ("provider", "note", "created_at")
    exclude = ("encrypted_api_key",)  # never expose raw keys in the admin


@admin.register(AITaskConfiguration)
class AITaskConfigurationAdmin(admin.ModelAdmin):
    list_display = ("task", "primary", "fallback_1")


@admin.register(AIProviderHealth)
class AIProviderHealthAdmin(admin.ModelAdmin):
    list_display = ("provider", "status", "success_count", "failure_count", "updated_at")


@admin.register(AIRequestLog)
class AIRequestLogAdmin(admin.ModelAdmin):
    list_display = ("task", "provider_used", "status", "user", "created_at")
    list_filter = ("status", "task")


@admin.register(AISettings)
class AISettingsAdmin(admin.ModelAdmin):
    list_display = ("enable_ai", "enable_fallback", "enable_caching", "maintenance_mode")
