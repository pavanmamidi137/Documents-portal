from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ["roll_number"]
    list_display = ["roll_number", "full_name", "role", "branch", "section", "is_active"]
    list_filter = ["role", "is_active", "branch", "section"]
    search_fields = ["roll_number", "full_name", "email", "phone"]

    fieldsets = (
        (None, {"fields": ("roll_number", "password")}),
        ("Personal info", {"fields": ("full_name", "email", "phone")}),
        ("College", {"fields": ("role", "branch", "section")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("roll_number", "full_name", "role", "branch", "section", "password1", "password2"),
        }),
    )
