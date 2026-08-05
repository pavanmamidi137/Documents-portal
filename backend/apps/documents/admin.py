from django.contrib import admin

from .models import Document


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = [
        "title", "branch", "section", "semester", "category", "subject",
        "uploaded_by", "downloads", "created_at",
    ]
    list_filter = ["branch", "section", "semester", "category", "subject"]
    search_fields = ["title", "file_name", "public_id"]
    readonly_fields = ["cloudinary_url", "public_id", "file_size", "downloads", "created_at"]
