import re

from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework import viewsets

from apps.core.models import Notification
from apps.core.permissions import IsSuperAdminForWrite
from apps.core.utils import log_audit, notify

from .models import Announcement
from .serializers import AnnouncementSerializer

User = get_user_model()


def _announcement_recipients(instance):
    """The students & CRs who can see this announcement (never the author)."""
    qs = User.objects.filter(is_active=True)
    students_and_crs = Q(role=User.Role.CR) | Q(role=User.Role.STUDENT)

    if instance.visibility == Announcement.Visibility.SECTION:
        qs = qs.filter(students_and_crs, section_id=instance.section_id)
    elif instance.visibility == Announcement.Visibility.BRANCH:
        qs = qs.filter(students_and_crs, branch_id=instance.branch_id)
    elif instance.visibility == Announcement.Visibility.CR_ONLY:
        qs = qs.filter(role=User.Role.CR)
    elif instance.visibility == Announcement.Visibility.STUDENT_ONLY:
        qs = qs.filter(role=User.Role.STUDENT)
    else:  # COLLEGE
        qs = qs.filter(students_and_crs)

    if instance.created_by_id:
        qs = qs.exclude(pk=instance.created_by_id)
    return qs


def _announcement_preview(instance) -> str:
    """A short, single-line preview for the notification message."""
    body = re.sub(r"\s+", " ", (instance.body or "").strip())
    if body:
        return body[:140] + ("…" if len(body) > 140 else "")
    return f"Posted for {instance.visibility_label}."


class AnnouncementViewSet(viewsets.ModelViewSet):
    queryset = Announcement.objects.select_related("branch", "section", "created_by").all()
    serializer_class = AnnouncementSerializer
    permission_classes = [IsSuperAdminForWrite]
    search_fields = ["title", "body"]
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user

        if user.is_super_admin:
            return qs
        if user.is_cr:
            return qs.filter(
                Q(visibility=Announcement.Visibility.COLLEGE)
                | Q(visibility=Announcement.Visibility.CR_ONLY)
                | (Q(visibility=Announcement.Visibility.BRANCH) & Q(branch_id=user.branch_id))
                | (Q(visibility=Announcement.Visibility.SECTION) & Q(section_id=user.section_id))
            )
        # Student
        return qs.filter(
            Q(visibility=Announcement.Visibility.COLLEGE)
            | Q(visibility=Announcement.Visibility.STUDENT_ONLY)
            | (Q(visibility=Announcement.Visibility.BRANCH) & Q(branch_id=user.branch_id))
            | (Q(visibility=Announcement.Visibility.SECTION) & Q(section_id=user.section_id))
        )

    def perform_create(self, serializer):
        instance = serializer.save(created_by=self.request.user)
        log_audit(self.request.user, "CREATE", "Announcement", instance.id,
                  {"title": instance.title, "visibility": instance.visibility}, self.request)
        notify(
            _announcement_recipients(instance),
            Notification.Kind.ANNOUNCEMENT,
            f"New announcement: {instance.title}",
            _announcement_preview(instance),
            "/announcements",
        )

    def perform_update(self, serializer):
        instance = serializer.save()
        log_audit(self.request.user, "UPDATE", "Announcement", instance.id,
                  {"title": instance.title}, self.request)

    def perform_destroy(self, instance):
        log_audit(self.request.user, "DELETE", "Announcement", instance.id,
                  {"title": instance.title}, self.request)
        instance.delete()
