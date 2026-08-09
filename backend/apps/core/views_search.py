from django.db.models import Q
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.announcements.models import Announcement
from apps.documents.models import Document
from apps.documents.serializers import DocumentListSerializer


class SearchView(APIView):
    """Global search scoped to the caller's role.

    Super Admin -> students, documents, announcements (everything)
    CR         -> students + documents in own section, announcements
    Student    -> documents + announcements for own branch/section
    """

    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return Response({"students": [], "documents": [], "announcements": []})

        user = request.user
        data = {
            "students": self._search_students(user, q),
            "documents": self._search_documents(user, q),
            "announcements": self._search_announcements(user, q),
        }
        return Response(data)

    @staticmethod
    def _search_students(user, q: str):
        from apps.accounts.models import User

        if not (user.is_super_admin or user.is_cr):
            return []
        qs = User.objects.filter(role__in=[User.Role.STUDENT, User.Role.CR])
        if user.is_cr:
            qs = qs.filter(branch_id=user.branch_id, section_id=user.section_id)
        qs = qs.filter(
            Q(roll_number__icontains=q)
            | Q(full_name__icontains=q)
            | Q(email__icontains=q)
            | Q(branch__name__icontains=q)
            | Q(section__name__icontains=q)
        ).select_related("branch", "section")[:25]
        return [
            {
                "id": s.id,
                "roll_number": s.roll_number,
                "full_name": s.full_name,
                "email": s.email,
                "phone": s.phone,
                "role": s.role,
                "branch_name": s.branch.name if s.branch else None,
                "branch_code": s.branch.code if s.branch else "",
                "section_name": s.section.name if s.section else None,
                "is_active": s.is_active,
            }
            for s in qs
        ]

    @staticmethod
    def _search_documents(user, q: str):
        # Files deleted directly in Cloudinary stay hidden everywhere.
        qs = Document.objects.exclude(is_missing=True)
        if user.is_cr:
            qs = qs.filter(branch_id=user.branch_id, section_id=user.section_id)
        elif user.is_student:
            qs = qs.filter(branch_id=user.branch_id, section_id=user.section_id)
        qs = qs.filter(
            Q(title__icontains=q)
            | Q(file_name__icontains=q)
            | Q(subject__name__icontains=q)
            | Q(category__name__icontains=q)
            | Q(semester__name__icontains=q)
            | Q(branch__name__icontains=q)
            | Q(section__name__icontains=q)
            | Q(uploaded_by__full_name__icontains=q)
        ).select_related("branch", "section", "semester", "category", "subject", "uploaded_by")[:25]
        return DocumentListSerializer(qs, many=True).data

    @staticmethod
    def _search_announcements(user, q: str):
        qs = Announcement.objects.filter(
            Q(title__icontains=q) | Q(body__icontains=q)
        )
        if user.is_super_admin:
            pass
        elif user.is_cr:
            qs = qs.filter(
                Q(visibility=Announcement.Visibility.COLLEGE)
                | Q(visibility=Announcement.Visibility.CR_ONLY)
                | (Q(visibility=Announcement.Visibility.BRANCH) & Q(branch_id=user.branch_id))
                | (Q(visibility=Announcement.Visibility.SECTION) & Q(section_id=user.section_id))
            )
        else:
            qs = qs.filter(
                Q(visibility=Announcement.Visibility.COLLEGE)
                | Q(visibility=Announcement.Visibility.STUDENT_ONLY)
                | (Q(visibility=Announcement.Visibility.BRANCH) & Q(branch_id=user.branch_id))
                | (Q(visibility=Announcement.Visibility.SECTION) & Q(section_id=user.section_id))
            )
        return [
            {
                "id": a.id,
                "title": a.title,
                "body": a.body,
                "visibility": a.visibility,
                "created_by": a.created_by.full_name if a.created_by else None,
                "created_at": a.created_at,
            }
            for a in qs.order_by("-created_at")[:15]
        ]
