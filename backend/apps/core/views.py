from django.db.models import Q
from django.http import JsonResponse
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.announcements.models import Announcement
from apps.college.models import Branch, Section, Subject
from apps.documents.models import Document
from apps.documents.serializers import DocumentListSerializer


def health(request):
    """Liveness probe used by Render."""
    return JsonResponse({"status": "ok"})


class DashboardView(APIView):
    """Role-aware dashboard statistics."""

    def get(self, request):
        user = request.user
        if user.is_super_admin:
            data = self._super_admin_stats()
        elif user.is_cr:
            data = self._cr_stats(user)
        else:
            data = self._student_stats(user)
        return Response(data)

    @staticmethod
    def _super_admin_stats():
        from django.db.models import Count

        from apps.accounts.models import User

        recent_docs = Document.objects.select_related(
            "branch", "section", "semester", "category", "subject", "uploaded_by"
        ).order_by("-created_at")[:8]
        docs_by_category = (
            Document.objects.values("category__name")
            .annotate(count=Count("id"))
            .order_by("-count")[:6]
        )
        docs_by_branch = (
            Document.objects.values("branch__name")
            .annotate(count=Count("id"))
            .order_by("-count")[:6]
        )
        return {
            "role": "SUPER_ADMIN",
            "totals": {
                "students": User.objects.filter(role=User.Role.STUDENT).count(),
                "crs": User.objects.filter(role=User.Role.CR).count(),
                "branches": Branch.objects.count(),
                "sections": Section.objects.count(),
                "subjects": Subject.objects.count(),
                "documents": Document.objects.count(),
            },
            "charts": {
                "by_category": list(docs_by_category),
                "by_branch": list(docs_by_branch),
            },
            "recent_uploads": DocumentListSerializer(recent_docs, many=True).data,
        }

    @staticmethod
    def _cr_stats(user):
        docs = Document.objects.filter(branch_id=user.branch_id, section_id=user.section_id)
        recent = docs.select_related(
            "branch", "section", "semester", "category", "subject", "uploaded_by"
        ).order_by("-created_at")[:6]
        return {
            "role": "CR",
            "totals": {
                "students": user.section.students.count() if user.section else 0,
                "documents": docs.count(),
                "categories": docs.values("category_id").distinct().count(),
            },
            "recent_uploads": DocumentListSerializer(recent, many=True).data,
        }

    @staticmethod
    def _student_stats(user):
        docs = Document.objects.filter(branch_id=user.branch_id, section_id=user.section_id)
        recent = docs.select_related(
            "branch", "section", "semester", "category", "subject"
        ).order_by("-created_at")[:6]

        visibility = (
            Q(visibility=Announcement.Visibility.COLLEGE)
            | Q(visibility=Announcement.Visibility.STUDENT_ONLY)
            | (Q(visibility=Announcement.Visibility.BRANCH) & Q(branch_id=user.branch_id))
            | (Q(visibility=Announcement.Visibility.SECTION) & Q(section_id=user.section_id))
        )
        announcements = Announcement.objects.filter(visibility).order_by("-created_at")[:5]
        return {
            "role": "STUDENT",
            "totals": {
                "documents": docs.count(),
                "semesters": docs.values("semester_id").distinct().count(),
                "announcements": Announcement.objects.filter(visibility).count(),
            },
            "recent_uploads": DocumentListSerializer(recent, many=True).data,
            "recent_announcements": [
                {"id": a.id, "title": a.title, "created_at": a.created_at} for a in announcements
            ],
        }
