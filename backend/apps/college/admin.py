from django.contrib import admin

from .models import Branch, Category, Section, Semester, Subject


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "created_at"]
    search_fields = ["name", "code"]


@admin.register(Section)
class SectionAdmin(admin.ModelAdmin):
    list_display = ["branch", "name"]
    search_fields = ["name", "branch__name"]


@admin.register(Semester)
class SemesterAdmin(admin.ModelAdmin):
    list_display = ["name", "order"]
    search_fields = ["name"]


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "icon"]
    search_fields = ["name"]


@admin.register(Subject)
class SubjectAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "semester", "branch"]
    list_filter = ["semester", "branch"]
    search_fields = ["name", "code"]
