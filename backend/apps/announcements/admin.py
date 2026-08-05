from django.contrib import admin

from .models import Announcement


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ["title", "visibility", "branch", "section", "created_by", "created_at"]
    list_filter = ["visibility", "branch", "section"]
    search_fields = ["title", "body"]
