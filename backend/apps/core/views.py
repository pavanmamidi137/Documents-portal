from django.db.models import Q
from django.http import JsonResponse
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.announcements.models import Announcement
from apps.college.models import Branch, Section, Subject
from apps.documents.models import Document
from apps.documents.serializers import DocumentListSerializer

from apps.accounts.models import Resume, User


def health(request):
    """Liveness probe used by Render."""
    return JsonResponse({"status": "ok"})


class DashboardView(APIView):
    """Role-aware dashboard statistics."""

    def get(self, request):
        """Role-aware dashboard stats, cached ~15s per user.

        The dashboard runs several aggregate COUNT queries plus recent-item
        serialization; under many concurrent users that is the most expensive
        read on the site. Document/resume writes bump the generation so the
        next load recomputes - users never wait for stale data.
        """
        from apps.core.utils import portal_caching_enabled, portal_version

        user = request.user
        cache = None
        if portal_caching_enabled():
            from django.core.cache import caches

            cache = caches["portal"]
            key = f"dash:{portal_version('dash')}:{user.pk}"
            cached = cache.get(key)
            if cached is not None:
                return Response(cached)

        if user.is_super_admin:
            data = self._super_admin_stats()
        elif user.is_cr:
            data = self._cr_stats(user)
        elif user.is_faculty:
            data = self._faculty_stats(user)
        else:
            data = self._student_stats(user)
        if cache is not None:
            cache.set(key, data, 15)
        return Response(data)

    @staticmethod
    def _super_admin_stats():
        from datetime import timedelta

        from django.db.models import Count, Max, Sum
        from django.db.models.functions import TruncDate
        from django.utils import timezone

        from apps.accounts.models import User

        # A branch-wide upload creates one Document row PER section, so every
        # stat below counts distinct files (public_id), not copies - otherwise
        # the dashboard shows 8x the documents the college actually uploaded.
        visible = Document.objects.exclude(is_missing=True)
        # Latest files, one per public_id, with the sections each is shared to.
        recent_groups = list(
            visible.values("public_id")
            .annotate(
                newest=Max("created_at"),
                copies=Count("id"),
                total_downloads=Sum("downloads"),
            )
            .order_by("-newest")[:8]
        )
        recent_pub_ids = [g["public_id"] for g in recent_groups]
        recent_rows = Document.objects.select_related(
            "branch", "section", "semester", "category", "subject", "uploaded_by"
        ).filter(public_id__in=recent_pub_ids)
        sections_map: dict[str, list[str]] = {}
        reps: dict[str, Document] = {}
        for row in recent_rows:
            sections_map.setdefault(row.public_id, []).append(row.section.name)
            if (
                row.public_id not in reps
                or row.created_at > reps[row.public_id].created_at
            ):
                reps[row.public_id] = row
        recent_uploads = []
        for group in recent_groups:
            doc = reps.get(group["public_id"])
            if doc is None:
                continue
            data = DocumentListSerializer(doc).data
            data["sections"] = sorted(sections_map.get(group["public_id"], []))
            data["section_count"] = group["copies"]
            data["total_downloads"] = group["total_downloads"]
            recent_uploads.append(data)
        docs_by_category = (
            visible.values("category__name")
            .annotate(count=Count("public_id", distinct=True))
            .order_by("-count")[:6]
        )
        docs_by_branch = (
            visible.values("branch__name")
            .annotate(count=Count("public_id", distinct=True))
            .order_by("-count")[:6]
        )
        # Students per pass-out batch (bar chart on the dashboard).
        students_by_batch = (
            User.objects.filter(role=User.Role.STUDENT)
            .exclude(passout_year__isnull=True)
            .values("passout_year")
            .annotate(count=Count("id"))
            .order_by("passout_year")
        )
        # Students per branch (pie chart on the dashboard).
        students_by_branch = (
            User.objects.filter(role=User.Role.STUDENT)
            .exclude(branch__isnull=True)
            .values("branch__name")
            .annotate(count=Count("id"))
            .order_by("-count")[:8]
        )
        # Documents uploaded per day for the last 14 days (area chart). Days
        # without uploads are zero-filled so the line never jumps around.
        # Counts distinct files - a branch-wide upload is one upload, not 8.
        since = timezone.now() - timedelta(days=13)
        day_counts = {
            row["day"]: row["count"]
            for row in (
                visible.filter(created_at__gte=since)
                .annotate(day=TruncDate("created_at"))
                .values("day")
                .annotate(count=Count("public_id", distinct=True))
            )
        }
        over_time = []
        for offset in range(13, -1, -1):
            day = (timezone.now() - timedelta(days=offset)).date()
            over_time.append({"date": day.isoformat(), "count": day_counts.get(day, 0)})
        return {
            "role": "SUPER_ADMIN",
            "totals": {
                "students": User.objects.filter(role=User.Role.STUDENT).count(),
                "crs": User.objects.filter(role=User.Role.CR).count(),
                "branches": Branch.objects.count(),
                "sections": Section.objects.count(),
                "subjects": Subject.objects.count(),
                # Distinct files - the same file in 8 sections is one document.
                "documents": visible.values("public_id").distinct().count(),
            },
            "charts": {
                "by_category": list(docs_by_category),
                "by_branch": list(docs_by_branch),
                "students_by_branch": list(students_by_branch),
                "by_passout_year": list(students_by_batch),
                "over_time": over_time,
            },
            "recent_uploads": recent_uploads,
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
    def _faculty_stats(user):
        """Faculty dashboard: everything about their own branch."""
        students = user.branch.students.filter(role=User.Role.STUDENT) if user.branch else None
        crs = user.branch.students.filter(role=User.Role.CR) if user.branch else None
        resumes = (
            Resume.objects.filter(student__branch_id=user.branch_id)
            if user.branch_id
            else Resume.objects.none()
        )
        # Resumes whose Cloudinary file was deleted are hidden everywhere.
        resumes = resumes.exclude(is_missing=True)
        recent = (
            resumes.select_related("student", "student__section")
            .order_by("-updated_at")[:8]
        )
        return {
            "role": "FACULTY",
            "totals": {
                "branches": 1,
                "sections": user.branch.sections.count() if user.branch else 0,
                "crs": crs.count() if crs else 0,
                "students": students.count() if students else 0,
                "resumes": resumes.count(),
                "pending_resumes": resumes.filter(is_reviewed=False).count(),
            },
            "recent_resumes": [
                {
                    "id": r.id,
                    "student_name": r.student.full_name,
                    "student_roll": r.student.roll_number,
                    "section_name": r.student.section.name if r.student.section else None,
                    "file_name": r.file_name,
                    "updated_at": r.updated_at,
                }
                for r in recent
            ],
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
