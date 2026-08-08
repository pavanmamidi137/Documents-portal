from django.contrib import admin

from .models import Drive


@admin.register(Drive)
class DriveAdmin(admin.ModelAdmin):
    list_display = ("company_name", "role", "last_date_to_apply", "posted_by", "created_at")
    list_filter = ("last_date_to_apply",)
    search_fields = ("company_name", "role", "eligible_roll_numbers")
