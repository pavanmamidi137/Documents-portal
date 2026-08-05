from django.db.models import Q
from rest_framework import viewsets

from apps.core.permissions import IsSuperAdminForWrite
from apps.core.utils import log_audit

from .models import Announcement
from .serializers import AnnouncementSerializer


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

    def perform_update(self, serializer):
        instance = serializer.save()
        log_audit(self.request.user, "UPDATE", "Announcement", instance.id,
                  {"title": instance.title}, self.request)

    def perform_destroy(self, instance):
        log_audit(self.request.user, "DELETE", "Announcement", instance.id,
                  {"title": instance.title}, self.request)
        instance.delete()
