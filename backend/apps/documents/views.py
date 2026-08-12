from django.conf import settings
from django.db.models import F, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsSuperAdmin, IsSuperAdminOrCR
from apps.core.utils import build_zip_response, csv_response, log_audit

from . import services
from .models import Document, DocumentShareRequest
from .serializers import (
    DocumentCreateSerializer,
    DocumentListSerializer,
    DocumentShareRequestSerializer,
)


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

    def list(self, request, *args, **kwargs):
        """Paginated document list, cached ~5s per user + filters.

        Everyone using the same filters gets the same rows, so repeated page
        loads (across many users) skip the SQL + serialization entirely.
        Document writes bump the generation, so new uploads/deletes show up
        right away. Super Admins asking with ``grouped=1`` get one row per
        FILE (not per section) with the sections listed on the row.
        """
        if request.user.is_super_admin and request.query_params.get("grouped") in (
            "1", "true", "True",
        ):
            return self._grouped_list(request)
        from apps.core.utils import get_or_set_list_cache

        data = get_or_set_list_cache(
            "list:docs",
            request.user,
            request.query_params,
            5,
            lambda: super(DocumentViewSet, self).list(request, *args, **kwargs).data,
        )
        return Response(data)

    def _grouped_list(self, request):
        """Super-admin list: ONE row per file, with every section listed.

        Uploading to a whole branch creates one Document row per section, so
        the plain list repeats the same file once per section. Grouping by the
        Cloudinary ``public_id`` collapses those copies into a single row that
        shows which sections have the file (``sections``), how many copies
        (``section_count``) and the downloads summed across them
        (``total_downloads``). Filters/search still apply to the underlying
        rows, and pagination counts files - not copies.
        """
        from django.db.models import Count, Max, Sum

        from apps.core.utils import get_or_set_list_cache

        def build():
            groups = list(
                self.get_queryset()
                .values("public_id")
                .annotate(
                    newest=Max("created_at"),
                    copies=Count("id"),
                    total_downloads=Sum("downloads"),
                )
                .order_by("-newest")
            )
            page = self.paginate_queryset(groups)
            if page is None:
                return self.get_paginated_response([]).data
            pub_ids = [g["public_id"] for g in page]
            # Scoped to the SAME filters/queryset as the list, so a section
            # filter only shows that section's copies on the row.
            rows = self.get_queryset().filter(public_id__in=pub_ids)
            sections: dict[str, list[str]] = {}
            reps: dict[str, Document] = {}
            for row in rows:
                sections.setdefault(row.public_id, []).append(row.section.name)
                if (
                    row.public_id not in reps
                    or row.created_at > reps[row.public_id].created_at
                ):
                    reps[row.public_id] = row
            results = []
            for group in page:
                doc = reps.get(group["public_id"])
                if doc is None:
                    continue
                data = DocumentListSerializer(doc).data
                data["sections"] = sorted(sections.get(group["public_id"], []))
                data["section_count"] = group["copies"]
                data["total_downloads"] = group["total_downloads"]
                results.append(data)
            return self.get_paginated_response(results).data

        # Same group as the plain list so document writes invalidate it too.
        data = get_or_set_list_cache(
            "list:docs", request.user, request.query_params, 5, build
        )
        return Response(data)

    def get_queryset(self):
        user = self.request.user
        # Files deleted directly in Cloudinary are hidden from every list until
        # a re-upload replaces them (is_missing is set by check-files).
        qs = Document.objects.select_related(
            "branch", "section", "semester", "category", "subject", "uploaded_by"
        ).exclude(is_missing=True)

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
        if self.action in ("create", "destroy", "bulk_delete", "share_request"):
            return [IsSuperAdminOrCR()]
        if self.action in ("share", "fork", "forkable"):
            return [IsSuperAdmin()]
        return [IsAuthenticated()]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        document = services.create_document(
            data, data.pop("file"), request.user, request=request
        )
        # CRs may request that other sections' CRs accept this document right
        # from the upload dialog (still no extra storage - the file is shared).
        created_requests = []
        if request.user.is_cr:
            # Uploads are multipart, but stay defensive for JSON payloads.
            raw = (
                request.data.getlist("share_with_sections")
                if hasattr(request.data, "getlist")
                else request.data.get("share_with_sections")
            ) or request.data.get("share_with_sections")
            if raw:
                if isinstance(raw, str):
                    raw = raw.split(",")
                ids = [int(i) for i in raw if str(i).lstrip("-").isdigit()]
                if ids:
                    from apps.college.models import Section

                    sections = (
                        Section.objects.filter(id__in=ids, branch_id=document.branch_id)
                        .exclude(id=document.section_id)
                    )
                    if sections:
                        created_requests = services.create_share_requests(
                            document, sections, request.user, request
                        )
        response_data = DocumentListSerializer(document).data
        if created_requests:
            response_data["share_requests"] = DocumentShareRequestSerializer(
                created_requests, many=True
            ).data
        return Response(response_data, status=status.HTTP_201_CREATED)

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

    @action(detail=True, methods=["post"], permission_classes=[IsSuperAdmin])
    def share_request(self, request, pk=None):
        """Request that other sections' CRs accept a copy of this document.

        CRs may only request sharing for documents in their own assigned
        section. The receiving section's CR accepts or declines via
        /document-share-requests/{id}/respond/.
        """
        from apps.college.models import Section

        document = _get_document_or_404(pk)
        user = request.user
        if user.is_cr and document.section_id != user.section_id:
            raise PermissionDenied(
                "You can only request sharing for documents in your own section."
            )
        section_ids = request.data.get("sections")
        if not isinstance(section_ids, list) or not section_ids:
            raise PermissionDenied('Provide a "sections" list to request sharing with.')
        sections = Section.objects.filter(
            id__in=[int(i) for i in section_ids if str(i).lstrip("-").isdigit()]
        )
        if not sections:
            raise PermissionDenied("No valid sections provided.")
        if any(s.branch_id != document.branch_id for s in sections):
            raise PermissionDenied(
                "All target sections must belong to the document's branch."
            )
        created = services.create_share_requests(document, sections, user, request)
        return Response({
            "requests": DocumentShareRequestSerializer(created, many=True).data,
            "count": len(created),
        })

    @action(detail=True, methods=["post"], permission_classes=[IsSuperAdmin])
    def fork(self, request, pk=None):
        """Fork a document into a section without re-uploading the file (admin).

        CRs use share requests instead; only a Super Admin may pass a target
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

    @action(detail=False, methods=["get"], permission_classes=[IsSuperAdmin])
    def forkable(self, request):
        """Documents that can be forked into the caller's section.

        For CRs: documents from other sections that are not already present in
        their own section. For admins: every document.
        """
        user = request.user
        qs = Document.objects.select_related(
            "branch", "section", "semester", "category", "subject", "uploaded_by"
        ).exclude(is_missing=True)
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

    @action(detail=False, methods=["post"], permission_classes=[IsSuperAdminOrCR])
    def bulk_delete(self, request):
        """Delete many documents in ONE request instead of one call per row.

        Pass ``{ids: [...]}`` for a specific selection, ``{public_ids: [...]}``
        (Super Admin only) to delete an entire file from EVERY section at once
        (used by the grouped "one row per file" view), or ``{all_matching:
        true}`` (with the same q/branch/section/semester/category/subject
        query params as the list) to delete every matching document at once.
        Scope rules match the list/destroy endpoints: CRs may only delete
        documents in their own assigned section. The Cloudinary file is only
        removed when the deleted rows were the last copies of that file across
        every section (sharing/forking keeps the file alive for others).
        """
        all_matching = request.data.get("all_matching") in (True, "true", "1", 1)
        qs = self.get_queryset()
        if request.user.is_cr:
            qs = qs.filter(section_id=request.user.section_id)
        if all_matching:
            docs = list(qs)
            # Safety cap: a misclick on "delete all" must not wipe thousands of
            # files in one request - narrow the filters instead.
            max_matches = int(getattr(settings, "BULK_DELETE_MAX_MATCHES", 5000))
            if len(docs) > max_matches:
                raise ValidationError({
                    "detail": (
                        f"This would delete {len(docs)} documents, more than the "
                        f"{max_matches}-document bulk-delete safety limit. Narrow your "
                        "search or filters (semester/category/subject) and try again."
                    )
                })
        else:
            raw_pub_ids = request.data.get("public_ids")
            if raw_pub_ids is not None:
                if not request.user.is_super_admin:
                    raise PermissionDenied(
                        "Only Super Admins can delete a file from every section at once."
                    )
                if not isinstance(raw_pub_ids, list) or not raw_pub_ids:
                    raise ValidationError({
                        "public_ids": "Provide a list of document public ids to delete."
                    })
                pub_ids = [str(p).strip() for p in raw_pub_ids if str(p).strip()]
                if not pub_ids:
                    raise ValidationError({
                        "public_ids": "Provide valid document public ids."
                    })
                docs = list(qs.filter(public_id__in=pub_ids))
            else:
                raw_ids = request.data.get("ids")
                if not isinstance(raw_ids, list) or not raw_ids:
                    raise ValidationError({"ids": "Provide a list of document ids to delete."})
                ids = [int(i) for i in raw_ids if str(i).lstrip("-").isdigit()]
                if not ids:
                    raise ValidationError({"ids": "Provide valid document ids."})
                docs = list(qs.filter(id__in=ids))
        if not docs:
            return Response({"deleted": 0})
        doc_ids = [d.id for d in docs]
        # Files still referenced by rows OUTSIDE this deletion are kept.
        keep_public_ids = set(
            Document.objects.filter(public_id__in={d.public_id for d in docs})
            .exclude(id__in=doc_ids)
            .values_list("public_id", flat=True)
        )
        # One Cloudinary call per unique file (two selected rows can share a
        # public_id via sharing/forking - the file must not be deleted twice).
        for public_id in {d.public_id for d in docs} - keep_public_ids:
            services.delete_document_file(public_id)
        Document.objects.filter(id__in=doc_ids).delete()
        log_audit(request.user, "BULK_DELETE", "Document", "",
                  {"count": len(docs), "all_matching": all_matching,
                   "titles": [d.title for d in docs][:20]}, request)
        return Response({"deleted": len(docs)})

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def download(self, request, pk=None):
        document = self.get_object()
        # Atomic increment avoids lost updates under concurrent downloads.
        Document.objects.filter(pk=document.pk).update(downloads=F("downloads") + 1)
        document.refresh_from_db(fields=["downloads"])
        log_audit(request.user, "DOCUMENT_DOWNLOAD", "Document", document.id,
                  {"title": document.title}, request)
        from .services import signed_raw_url

        return Response({
            "download_url": document.download_url,
            # Signed so previews work even on restricted-delivery accounts.
            "cloudinary_url": signed_raw_url(document.public_id),
        })

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def extract_text(self, request, pk=None):
        """Extract readable text from a document PDF (OCR for scanned files).

        Text-based PDFs are read directly (free, instant). Scanned PDFs are
        OCR'd via the AI router (charged to the college's admin) and the result
        is stored, so repeated requests are free. The caller must be able to
        see the document (student/CR scoped to their section, admin everything).
        Returns 409 while an extraction is already running.
        """
        from datetime import timedelta

        from django.utils import timezone

        from .ocr import extract_document_text

        document = self.get_object()
        if document.ocr_status == Document.OcrStatus.COMPLETE:
            return Response({
                "ocr_status": "COMPLETE",
                "ocr_text": document.ocr_text,
                "ocr_error": "",
            })

        # A stale PENDING (crashed background worker) resets so it can re-run.
        stale = (
            document.ocr_status == Document.OcrStatus.PENDING
            and document.ocr_updated_at is not None
            and document.ocr_updated_at < timezone.now() - timedelta(minutes=5)
        )
        if stale:
            Document.objects.filter(pk=document.pk).update(
                ocr_status=Document.OcrStatus.NONE
            )
        # Atomic claim: only NONE/FAILED rows can start a run - a concurrent
        # request (or the upload worker) that already claimed it gets 409.
        claimed = Document.objects.filter(
            pk=document.pk, ocr_status__in=["NONE", "FAILED"]
        ).update(
            ocr_status=Document.OcrStatus.PENDING, ocr_error="",
            ocr_updated_at=timezone.now(),
        )
        if not claimed:
            return Response(
                {"detail": "Text extraction is already running. Please wait a moment."},
                status=status.HTTP_409_CONFLICT,
            )

        document.refresh_from_db(fields=["ocr_status", "ocr_updated_at"])
        return Response(extract_document_text(document, request.user))

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def tree(self, request):
        """Every document visible to the caller, unpaginated (capped at 1000).

        The student browser builds its Subjects → Categories → Units →
        Documents drill-down locally from this single response, so navigating
        between levels is instant - no per-level fetches. Students are already
        scoped to their own branch + section by ``get_queryset``.
        """
        from apps.core.utils import portal_caching_enabled, portal_version

        cache = None
        if portal_caching_enabled():
            from django.core.cache import caches

            cache = caches["portal"]
            key = f"tree:{portal_version('tree')}:{request.user.pk}"
            cached = cache.get(key)
            if cached is not None:
                return Response(cached)

        base = self.get_queryset()
        total = base.count()
        qs = base.order_by("-created_at")[:1000]
        serializer = DocumentListSerializer(qs, many=True)
        data = {
            "count": len(serializer.data),
            "total": total,  # lets the UI hint when the cap kicked in
            "results": serializer.data,
        }
        if cache is not None:
            # Short TTL: uploads/deletes bump the generation and drop this
            # entry anyway, and file-missing flags refresh within seconds.
            cache.set(key, data, 15)
        return Response(data)

    @action(detail=False, methods=["get"], url_path="check-files", permission_classes=[IsAuthenticated])
    def check_files(self, request):
        """Verify the current view's files still exist on Cloudinary.

        Called by the frontend when a document list loads: files in the current
        view that have not been checked in the last minute are verified via the
        admin API and any that were deleted directly in Cloudinary are flagged
        missing and hidden immediately. Long-missing files are re-checked too,
        so a file restored in the Cloudinary console reappears. Returns the ids
        that were removed so the UI can drop them without a refetch.
        """
        from datetime import timedelta

        from django.utils import timezone

        from .services import cloudinary_files_status

        cutoff = timezone.now() - timedelta(seconds=60)
        visible = self.get_queryset().filter(
            Q(file_checked_at__lt=cutoff) | Q(file_checked_at__isnull=True)
        )[:100]
        # Re-check files that were found missing a while ago (revival support).
        stale_missing = Document.objects.filter(
            is_missing=True, file_checked_at__lt=cutoff
        )[:50]
        candidates = list(visible) + list(stale_missing)
        # One batched Cloudinary call per 100 ids - not one round-trip per file.
        statuses = cloudinary_files_status([d.public_id for d in candidates])
        if statuses is None:
            return Response({"checked": 0, "missing_ids": [], "restored_ids": []})
        missing_ids: list[int] = []
        restored_ids: list[int] = []
        checked = 0
        for doc in candidates:
            exists = statuses.get(doc.public_id)
            checked += 1
            now = timezone.now()
            if not exists:
                if not doc.is_missing:
                    missing_ids.append(doc.id)
                Document.objects.filter(pk=doc.pk).update(
                    is_missing=True, file_checked_at=now, restored_at=None
                )
            else:
                updates = {"is_missing": False, "file_checked_at": now}
                if doc.is_missing:
                    # The file came back (restored in Cloudinary) - unhide it
                    # with a restored marker so the UI can show a badge.
                    restored_ids.append(doc.id)
                    updates["restored_at"] = now
                elif doc.restored_at and doc.restored_at < now - timedelta(days=3):
                    # The "Restored" badge fades out a few days after revival.
                    updates["restored_at"] = None
                else:
                    continue  # unchanged - avoid a pointless write
                Document.objects.filter(pk=doc.pk).update(**updates)
        return Response({
            "checked": checked,
            "missing_ids": missing_ids,
            "restored_ids": restored_ids,
        })

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def download_zip(self, request):
        """Download every file in the current filtered view as one ZIP.

        Files are fetched through signed Cloudinary delivery URLs so the ZIP
        works even on accounts with restricted delivery. Capped at 100 files /
        150MB to keep the in-memory bundle reasonable.
        """
        import urllib.request

        from .services import signed_raw_url

        max_files = 100
        max_bytes = 150 * 1024 * 1024
        files: list[tuple[str, bytes]] = []
        skipped = 0
        total = 0
        for doc in self.get_queryset()[:max_files]:
            try:
                with urllib.request.urlopen(signed_raw_url(doc.public_id), timeout=10) as resp:
                    data = resp.read()
                if total + len(data) > max_bytes:
                    skipped += 1
                    continue
                files.append((doc.file_name, data))
                total += len(data)
            except Exception:
                skipped += 1
        if not files:
            raise ValidationError({
                "detail": "No files could be downloaded. Check the Cloudinary 'Allow delivery of PDF and ZIP files' setting (Settings > Security)."
            })
        log_audit(request.user, "ZIP_DOWNLOAD", "Document", "",
                  {"count": len(files), "skipped": skipped}, request)
        return build_zip_response(files, "documents.zip")

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


class DocumentShareRequestViewSet(viewsets.ModelViewSet):
    """In-app notifications for cross-section document sharing.

    CRs see the requests they receive (incoming) and the ones they sent
    (outgoing); Super Admins see everything. Accepting a request materializes
    the document in the receiving section.
    """

    http_method_names = ["get", "post", "delete", "head", "options"]
    serializer_class = DocumentShareRequestSerializer
    permission_classes = [IsSuperAdminOrCR]

    def get_queryset(self):
        user = self.request.user
        qs = DocumentShareRequest.objects.select_related(
            "document",
            "document__subject",
            "document__category",
            "document__semester",
            "from_section",
            "from_section__branch",
            "to_section",
            "requested_by",
        )
        if not user.is_super_admin:
            qs = qs.filter(
                Q(to_section_id=user.section_id) | Q(from_section_id=user.section_id)
            )
        params = self.request.query_params
        scope = params.get("scope", "").lower()
        if scope == "incoming":
            qs = qs.filter(to_section_id=user.section_id)
        elif scope == "outgoing":
            qs = qs.filter(from_section_id=user.section_id)
        if params.get("status"):
            qs = qs.filter(status=params["status"].upper())
        return qs

    def destroy(self, request, *args, **kwargs):
        share_request = self.get_object()
        if not request.user.is_super_admin and share_request.requested_by_id != request.user.id:
            raise PermissionDenied(
                "Only the requester (or a Super Admin) can cancel this request."
            )
        if share_request.status != DocumentShareRequest.Status.PENDING:
            raise PermissionDenied("Only pending requests can be cancelled.")
        share_request.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def respond(self, request, pk=None):
        """Accept or decline a pending request received for the caller's section."""
        share_request = self.get_object()
        user = request.user
        if (
            not user.is_super_admin
            and share_request.to_section_id != user.section_id
        ):
            raise PermissionDenied(
                "Only the receiving section's CR can respond to this request."
            )
        if share_request.status != DocumentShareRequest.Status.PENDING:
            raise ValidationError(
                {"detail": "This request has already been responded to."}
            )
        accept = request.data.get("accept") in (True, "true", "1", 1)
        share_request, _copy = services.respond_share_request(
            share_request, accept, user, request
        )
        return Response(DocumentShareRequestSerializer(share_request).data)
