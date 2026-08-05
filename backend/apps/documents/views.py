from django.db.models import F, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsSuperAdmin, IsSuperAdminOrCR
from apps.core.utils import csv_response, log_audit

from . import services
from .models import Document
from .serializers import DocumentCreateSerializer, DocumentListSerializer


def _get_document_or_404(pk):
    """Fetch any document regardless of the caller's section scoping."""
    document = Document.objects.select_related(
        "branch", "section", "semester", "category", "subject", "uploaded_by"
    ).filter(pk=pk).first()
    if not document:
        raise PermissionDenied("Document not found.")
    return document


class DocumentViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "delete", "head", "options"]
    serializer_class = DocumentListSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = Document.objects.select_related(
            "branch", "section", "semester", "category", "subject", "uploaded_by"
        ).all()

        if user.is_super_admin:
            pass
        elif user.is_cr:
            qs = qs.filter(branch_id=user.branch_id, section_id=user.section_id)
        else:  # student: only own branch + section
            qs = qs.filter(branch_id=user.branch_id, section_id=user.section_id)

        params = self.request.query_params
        for field in ("branch", "section", "semester", "category", "subject"):
            value = params.get(field)
            if value:
                qs = qs.filter(**{f"{field}_id": value})
        q = params.get("q", "").strip()
        if q:
            qs = qs.filter(
                Q(title__icontains=q)
                | Q(file_name__icontains=q)
                | Q(subject__name__icontains=q)
                | Q(category__name__icontains=q)
                | Q(uploaded_by__full_name__icontains=q)
            )
        ordering = params.get("ordering", "-created_at")
        if ordering.lstrip("-") in {"created_at", "title", "downloads"}:
            qs = qs.order_by(ordering)
        return qs

    def get_serializer_class(self):
        if self.action == "create":
            return DocumentCreateSerializer
        return DocumentListSerializer

    def get_permissions(self):
        if self.action in ("create", "destroy"):
            return [IsSuperAdminOrCR()]
        if self.action in ("share",):
            return [IsSuperAdmin()]
        if self.action in ("fork", "forkable"):
            return [IsSuperAdminOrCR()]
        return [IsAuthenticated()]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        document = services.create_document(
            data, data.pop("file"), request.user, request=request
        )
        return Response(
            DocumentListSerializer(document).data, status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=["post"], permission_classes=[IsSuperAdmin])
    def share(self, request, pk=None):
        """Share an existing document to one or more additional sections."""
        from apps.college.models import Section

        document = _get_document_or_404(pk)
        section_ids = request.data.get("sections")
        if not isinstance(section_ids, list) or not section_ids:
            raise PermissionDenied("Provide a \"sections\" list to share with.")
        sections = Section.objects.filter(
            id__in=[int(i) for i in section_ids if str(i).lstrip("-").isdigit()]
        )
        if not sections:
            raise PermissionDenied("No valid sections provided.")
        if any(s.branch_id != document.branch_id for s in sections):
            raise PermissionDenied(
                "All target sections must belong to the document's branch."
            )
        created = services.share_document(document, sections, request.user, request)
        return Response({
            "shared": DocumentListSerializer(created, many=True).data,
            "count": len(created),
        })

    @action(detail=True, methods=["post"], permission_classes=[IsSuperAdminOrCR])
    def fork(self, request, pk=None):
        """Fork a document into a section without re-uploading the file.

        CRs always fork into their own assigned section; admins pass a target
        section id in the body.
        """
        from apps.college.models import Section

        document = _get_document_or_404(pk)
        user = request.user
        if user.is_cr:
            if not user.section_id:
                raise PermissionDenied("Your account is not assigned to a section.")
            section = Section.objects.filter(pk=user.section_id).first()
            if not section:
                raise PermissionDenied("Your assigned section no longer exists.")
        else:
            raw = request.data.get("section")
            if not raw or not str(raw).lstrip("-").isdigit():
                raise PermissionDenied("Provide a valid target \"section\" id.")
            section = Section.objects.filter(pk=int(raw)).first()
            if not section:
                raise PermissionDenied("Section not found.")
        # A fork copy must stay consistent: the section belongs to the same branch.
        if section.branch_id != document.branch_id:
            raise PermissionDenied(
                "The target section must belong to the document's branch."
            )
        forked = services.fork_document(document, section, user, request)
        return Response(
            DocumentListSerializer(forked).data, status=status.HTTP_201_CREATED
        )

    @action(detail=False, methods=["get"], permission_classes=[IsSuperAdminOrCR])
    def forkable(self, request):
        """Documents that can be forked into the caller's section.

        For CRs: documents from other sections that are not already present in
        their own section. For admins: every document.
        """
        user = request.user
        qs = Document.objects.select_related(
            "branch", "section", "semester", "category", "subject", "uploaded_by"
        ).all()
        if user.is_cr and user.section_id:
            own_public_ids = Document.objects.filter(section_id=user.section_id).values_list(
                "public_id", flat=True
            )
            # Only same-branch documents from other sections (fork keeps the
            # document's branch, so the target section must match it).
            qs = (
                qs.filter(branch_id=user.branch_id)
                .exclude(section_id=user.section_id)
                .exclude(public_id__in=own_public_ids)
            )
        q = request.query_params.get("q", "").strip()
        if q:
            qs = qs.filter(
                Q(title__icontains=q)
                | Q(subject__name__icontains=q)
                | Q(section__name__icontains=q)
                | Q(uploaded_by__full_name__icontains=q)
            )
        return Response({
            "results": DocumentListSerializer(qs.order_by("-created_at")[:100], many=True).data,
        })

    def destroy(self, request, *args, **kwargs):
        document = self.get_object()
        user = request.user
        if user.is_cr and document.section_id != user.section_id:
            raise PermissionDenied("You can only delete documents in your assigned section.")
        services.delete_document(document, user, request)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def download(self, request, pk=None):
        document = self.get_object()
        # Atomic increment avoids lost updates under concurrent downloads.
        Document.objects.filter(pk=document.pk).update(downloads=F("downloads") + 1)
        document.refresh_from_db(fields=["downloads"])
        log_audit(request.user, "DOCUMENT_DOWNLOAD", "Document", document.id,
                  {"title": document.title}, request)
        return Response({
            "download_url": document.download_url,
            "cloudinary_url": document.cloudinary_url,
        })

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def export_csv(self, request):
        qs = self.get_queryset()
        rows = [
            [d.title, d.file_name, d.branch.name, d.section.name, d.semester.name,
             d.category.name, d.subject.name,
             d.uploaded_by.full_name if d.uploaded_by else "",
             d.created_at.strftime("%Y-%m-%d"), d.downloads]
            for d in qs.iterator()
        ]
        log_audit(request.user, "CSV_EXPORT", "Document", "",
                  {"count": len(rows)}, request)
        return csv_response(
            "documents.csv",
            ["Title", "File Name", "Branch", "Section", "Semester", "Category",
             "Subject", "Uploaded By", "Upload Date", "Downloads"],
            rows,
        )
