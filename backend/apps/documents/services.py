"""Document upload lifecycle.

Documents (PDF / PPT / PPTX / DOC / DOCX / TXT) go to Cloudinary as RAW
files under:
    documents/{branch}/{section}/{semester}/{category}/{subject}/

The database stores only the Cloudinary URL + public id.
"""
import cloudinary
import cloudinary.api
import cloudinary.uploader
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.utils import log_audit, slugify
from .compress import compress_file

# Configure the SDK once at import time (env values are loaded by settings).
cloudinary.config(
    cloud_name=settings.CLOUDINARY["CLOUD_NAME"],
    api_key=settings.CLOUDINARY["API_KEY"],
    api_secret=settings.CLOUDINARY["API_SECRET"],
    secure=True,
)


# Extension -> (magic bytes, allowed content types). None magic bytes means
# no signature check (plain text files). All lowercase.
ALLOWED_DOCUMENT_TYPES = {
    ".pdf": (
        b"%PDF-",
        ["application/pdf"],
    ),
    ".ppt": (
        b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",  # OLE compound document
        ["application/vnd.ms-powerpoint"],
    ),
    ".pptx": (
        b"PK\x03\x04",  # ZIP container (OOXML)
        ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ),
    ".doc": (
        b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",  # OLE compound document
        ["application/msword"],
    ),
    ".docx": (
        b"PK\x03\x04",  # ZIP container (OOXML)
        ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ),
    ".txt": (None, ["text/plain"]),
}

VALID_EXTENSIONS = tuple(ALLOWED_DOCUMENT_TYPES)


def validate_document(document_file) -> None:
    """Reject unsupported files and files over the size limit.

    Checks the client-supplied content type/extension AND the file's magic
    bytes, so a renamed HTML/JS file cannot be stored or previewed.
    """
    if not document_file:
        raise ValidationError({"file": "A document file is required."})
    if document_file.size <= 0:
        raise ValidationError({"file": "The uploaded file is empty."})

    # Strip any MIME parameters (e.g. "; charset=...") so the comparison below
    # never false-rejects a generic type because of a charset suffix.
    content_type = ((getattr(document_file, "content_type", "") or "").lower().split(";")[0].strip())
    name = (getattr(document_file, "name", "") or "").lower()
    _, _, ext_part = name.rpartition(".")
    ext = f".{ext_part}" if ext_part else ""

    allowed = ALLOWED_DOCUMENT_TYPES.get(ext)
    if not allowed:
        raise ValidationError({"file": "Only PDF, PPT, PPTX, DOC, DOCX or TXT files are allowed."})

    magic, content_types = allowed
    # The MIME check is best-effort only: many real sources report a generic
    # type (WhatsApp downloads, some browsers, renamed files all commonly send
    # application/octet-stream), which would false-reject perfectly valid
    # documents. The magic-byte check below is the authoritative content
    # validation, so only reject on a MIME that clearly conflicts with the
    # extension; generic/unknown types are allowed through.
    generic_types = {
        "", "application/octet-stream", "application/binary",
        "binary/octet-stream", "application/x-msdownload", "application/x-binary",
    }
    if (
        content_types
        and content_type
        and content_type not in generic_types
        and content_type not in content_types
    ):
        raise ValidationError(
            {"file": "The file type does not match its extension."}
        )

    if magic is not None:
        # Magic-byte check: read enough bytes for the longest signature.
        header = document_file.read(len(magic))
        document_file.seek(0)
        if header != magic:
            raise ValidationError(
                {"file": f"The file is not a valid {ext.upper().lstrip('.')} document."}
            )

    # The input ceiling is above the post-compression cap so large files still
    # get a chance to be compressed down to size in ``upload_document``.
    input_ceiling = settings.DOCUMENT_MAX_INPUT_MB * 1024 * 1024
    if document_file.size > input_ceiling:
        raise ValidationError(
            {"file": f"File exceeds the {settings.DOCUMENT_MAX_INPUT_MB}MB upload ceiling."}
        )


def build_folder(branch, section, semester, category, subject) -> str:
    """Cloudinary folder: documents/{branch}/{section}/{semester}/{category}/{subject}/"""
    parts = [
        "documents",
        slugify(branch.name),
        slugify(section.name),
        slugify(semester.name),
        slugify(category.name),
        slugify(subject.name),
    ]
    return "/".join(parts)


def upload_document(document_file, folder: str, target_bytes: int | None = None) -> dict:
    """Upload a validated document to Cloudinary and return its references.

    Large PDFs and Office files are compressed automatically before upload.
    When ``target_bytes`` is set (resumes: 500KB), the file is rejected after
    compression if it still exceeds that cap.
    """
    validate_document(document_file)
    # Post-compression size cap: resumes must fit their 500KB target;
    # documents must fit the regular size limit.
    cap_bytes = (
        target_bytes
        if target_bytes is not None
        else settings.MAX_DOCUMENT_SIZE_MB * 1024 * 1024
    )
    # Documents compress when larger than the general threshold; resumes (which
    # pass a smaller ``target_bytes``) are compressed as soon as they exceed it.
    compress_over = settings.DOCUMENT_COMPRESS_AFTER_BYTES
    if target_bytes:
        compress_over = min(compress_over, target_bytes)
    if document_file.size > compress_over:
        # Target-aware: the compressor keeps trying progressively more
        # aggressive passes until the result fits under ``cap_bytes``.
        compressed = compress_file(document_file, target_bytes=cap_bytes)
        if compressed is not None:
            document_file = SimpleUploadedFile(
                document_file.name,
                compressed,
                content_type=getattr(document_file, "content_type", "") or "",
            )
    if document_file.size > cap_bytes:
        if target_bytes is not None:
            raise ValidationError({
                "file": (
                    f"The file is still larger than {target_bytes // 1024}KB "
                    "even after automatic compression (where supported). "
                    "Please reduce the file size and try again."
                )
            })
        raise ValidationError({
            "file": (
                f"File still exceeds the {settings.MAX_DOCUMENT_SIZE_MB}MB size "
                "limit even after automatic compression. The file could not be "
                "shrunk enough - this can happen with mostly-text PDFs or older "
                "PPT/DOC files. Try a smaller file, remove embedded images, or "
                "split it into parts."
            )
        })
    try:
        result = _cloudinary_upload(document_file, folder)
    except Exception as exc:  # network / API errors bubble up as a 400
        raise ValidationError({"file": f"Cloudinary upload failed: {exc}"})
    return {
        "url": result["secure_url"],
        "public_id": result["public_id"],
        "file_name": document_file.name,
        "file_size": document_file.size,
    }


def _cloudinary_upload(document_file, folder: str, resource_type: str = "raw") -> dict:
    """Upload a file to Cloudinary, chunked when it is large.

    Cloudinary's standard ``upload`` endpoint rejects raw payloads at/over
    10MB ("File size too large. Maximum is 10485760"), so files at or above
    that cap go through ``upload_large`` (chunked upload, supports files up
    to 100MB+). Smaller files keep the regular single-request upload.
    """
    options = dict(
        resource_type=resource_type,
        folder=folder,
        use_filename=True,
        unique_filename=True,
        overwrite=False,
    )
    if document_file.size >= settings.CLOUDINARY_SINGLE_UPLOAD_BYTES:
        options["chunk_size"] = settings.CLOUDINARY_CHUNK_BYTES
        return cloudinary.uploader.upload_large(document_file, **options)
    return cloudinary.uploader.upload(document_file, **options)


def delete_document_file(public_id: str) -> bool:
    """Remove a raw file from Cloudinary. Returns False on failure."""
    try:
        cloudinary.api.delete_resources([public_id], resource_type="raw")
        return True
    except Exception:
        return False


def cloudinary_file_exists(public_id: str):
    """Check whether a raw file still exists on Cloudinary (admin API).

    Returns True when present, False when it has been deleted, and None when
    the check itself failed (auth/network) - callers must not mark files as
    missing when the answer is unknown.
    """
    try:
        cloudinary.api.resource(public_id, resource_type="raw")
        return True
    except cloudinary.exceptions.NotFound:
        return False
    except Exception:
        return None


def cloudinary_files_status(public_ids):
    """Bulk existence check for raw files (Cloudinary admin API).

    Returns {public_id: True/False} for the given ids using one batched
    request per 100 ids instead of a separate admin API round-trip per file.
    Returns None when the check itself failed (auth/network) - callers must
    not mark files as missing when the answer is unknown.
    """
    if not public_ids:
        return {}
    try:
        existing = set()
        # resources_by_ids returns only resources that still exist; deleted
        # ids are simply absent from the response. Max 100 ids per call.
        for start in range(0, len(public_ids), 100):
            chunk = public_ids[start : start + 100]
            result = cloudinary.api.resources_by_ids(chunk, resource_type="raw")
            existing.update(
                r["public_id"]
                for r in result.get("resources", [])
                if r.get("public_id")
            )
        return {pid: pid in existing for pid in public_ids}
    except Exception:
        return None


def signed_raw_url(public_id: str, attachment: bool = False) -> str:
    """Cloudinary delivery URL for a raw file, signed with the API secret.

    Some accounts restrict anonymous delivery ("Signed URLs" security setting
    or an access-control rule), which makes plain raw URLs return HTTP 401
    "deny or ACL failure" - the browser then shows "Failed to load PDF
    document". A signed URL is accepted by Cloudinary in that mode and is
    still harmless when delivery is unrestricted.
    """
    from cloudinary.utils import cloudinary_url

    options = {"resource_type": "raw", "sign_url": True}
    if attachment:
        options["flags"] = "attachment"
    url, _ = cloudinary_url(public_id, **options)
    return url


def _notify_section_document(sections, primary):
    """Fan out "new document" notifications to students+CRs of the sections."""
    from apps.accounts.models import User

    from apps.core.models import Notification
    from apps.core.utils import notify

    recipients = User.objects.filter(
        section_id__in=[s.id for s in sections],
        role__in=[User.Role.STUDENT, User.Role.CR],
        is_active=True,
    )
    notify(
        recipients,
        Notification.Kind.DOCUMENT_UPLOAD,
        f"New document: {primary.title}",
        f"{primary.subject.name} · {primary.category.name} ({primary.semester.name}) is now available in your section.",
        "/documents",
        document_public_id=primary.public_id,
    )


def create_document(data: dict, document_file, actor, request=None):
    """Upload the document once and create one record per target section.

    Admin can share a single upload to several sections at once; CRs always
    get a single record for their own section. Returns the primary record.
    """
    from .models import Document

    sections = data.get("sections") or [data["section"]]
    folder = build_folder(
        data["branch"], sections[0], data["semester"],
        data["category"], data["subject"],
    )
    uploaded = upload_document(document_file, folder)

    common = {
        "title": data["title"].strip(),
        "description": data.get("description", "").strip(),
        "submission_deadline": data.get("submission_deadline"),
        "file_name": uploaded["file_name"],
        "file_size": uploaded["file_size"],
        "cloudinary_url": uploaded["url"],
        "public_id": uploaded["public_id"],
        "branch": data["branch"],
        "semester": data["semester"],
        "category": data["category"],
        "subject": data["subject"],
        "uploaded_by": actor,
    }
    created = [
        Document.objects.create(section=section, **common)
        for section in sections
    ]
    primary = created[0]
    log_audit(
        actor, "DOCUMENT_UPLOAD", "Document", primary.id,
        {
            "title": primary.title,
            "public_id": primary.public_id,
            "branch": primary.branch.name,
            "sections": [s.section.name for s in created],
            "semester": primary.semester.name,
            "category": primary.category.name,
            "subject": primary.subject.name,
        },
        request,
    )
    _notify_section_document(sections, primary)
    # Scanned PDF documents are OCR'd in the background so their text is ready
    # for search/reading shortly after upload (text PDFs are read for free).
    maybe_auto_extract(primary, actor)
    return primary


def maybe_auto_extract(document, actor):
    """Auto-extract text from a freshly uploaded PDF document in the background.

    Returns immediately for non-PDFs or when disabled (DOCUMENT_AUTO_OCR=0) so
    uploads stay instant. The worker resolves the status to COMPLETE/FAILED
    itself - a text PDF costs nothing (pypdf), a scanned one uses AI OCR
    charged to the college's admin.
    """
    import os
    import threading

    from .models import Document
    from .ocr import extract_document_text

    if not (document.file_name or "").lower().endswith(".pdf"):
        return
    if os.environ.get("DOCUMENT_AUTO_OCR", "1") == "0":
        return
    Document.objects.filter(pk=document.pk).update(
        ocr_status=Document.OcrStatus.PENDING, ocr_error="",
        ocr_updated_at=timezone.now(),
    )

    def run():
        # This thread outlives the request, so it needs its own DB connections:
        # Django closes the request's connection when the response finishes.
        from django.db import close_old_connections

        close_old_connections()
        try:
            extract_document_text(document, actor)
        except Exception:  # pragma: no cover - never leave the row stuck PENDING
            try:
                Document.objects.filter(pk=document.pk, ocr_status="PENDING").update(
                    ocr_status=Document.OcrStatus.FAILED,
                    ocr_error="Automatic text extraction failed.",
                    ocr_updated_at=timezone.now(),
                )
            except Exception:
                pass
        finally:
            close_old_connections()

    threading.Thread(target=run, daemon=True).start()


def share_document(document, sections, actor, request=None):
    """Share an existing document to additional sections (admin).

    Copies the same Cloudinary reference to each section that does not already
    have it. Returns the list of newly created records.
    """
    from .models import Document

    existing = set(
        Document.objects.filter(public_id=document.public_id).values_list("section_id", flat=True)
    )
    created = []
    for section in sections:
        if section.id in existing:
            continue
        created.append(
            Document.objects.create(
                title=document.title,
                description=document.description,
                submission_deadline=document.submission_deadline,
                file_name=document.file_name,
                file_size=document.file_size,
                cloudinary_url=document.cloudinary_url,
                public_id=document.public_id,
                branch=document.branch,
                section=section,
                semester=document.semester,
                category=document.category,
                subject=document.subject,
                uploaded_by=actor,
                forked_from=document,
                # Same file -> same extracted text (no re-OCR needed).
                ocr_status=document.ocr_status,
                ocr_text=document.ocr_text,
                ocr_error=document.ocr_error,
                ocr_updated_at=document.ocr_updated_at,
            )
        )
    log_audit(
        actor, "DOCUMENT_SHARE", "Document", document.id,
        {
            "title": document.title,
            "public_id": document.public_id,
            "sections": [s.section.name for s in created],
        },
        request,
    )
    if created:
        _notify_section_document([c.section for c in created], document)
    return created


def create_share_requests(document, sections, actor, request=None):
    """Request that other sections' CRs accept a copy of a document.

    The file is never re-uploaded; the receiving section's CR decides whether
    to accept (which creates the local Document row). Sections that already
    have the document are skipped, and duplicate pending requests are avoided.
    Returns the list of newly created DocumentShareRequest rows.
    """
    from .models import Document, DocumentShareRequest

    existing = set(
        Document.objects.filter(public_id=document.public_id).values_list(
            "section_id", flat=True
        )
    )
    created = []
    for section in sections:
        if section.id in existing or section.id == document.section_id:
            continue
        if DocumentShareRequest.objects.filter(
            document=document,
            to_section=section,
            status=DocumentShareRequest.Status.PENDING,
        ).exists():
            continue
        # A declined/older request is superseded by a fresh one.
        DocumentShareRequest.objects.filter(
            document=document, to_section=section
        ).delete()
        created.append(
            DocumentShareRequest.objects.create(
                document=document,
                from_section=document.section,
                to_section=section,
                requested_by=actor,
            )
        )
    log_audit(
        actor, "DOCUMENT_SHARE", "Document", document.id,
        {
            "title": document.title,
            "public_id": document.public_id,
            "requested_sections": [s.name for s in sections],
            "requests_created": len(created),
        },
        request,
    )
    return created


def respond_share_request(share_request, accept: bool, actor, request=None):
    """Accept or decline a pending document share request.

    Accepting creates a copy of the document in the target section (same
    Cloudinary file, no re-upload) so that section's students can access it.
    Returns the updated request and the created copy (or None when declined).
    """
    from .models import DocumentShareRequest

    copy = None
    if accept:
        copy = fork_document(
            share_request.document, share_request.to_section, actor, request
        )
        # Accepting makes the document available in the new section - the
        # students there hear about it just like a direct upload.
        _notify_section_document([share_request.to_section], share_request.document)
        new_status = DocumentShareRequest.Status.ACCEPTED
    else:
        new_status = DocumentShareRequest.Status.DECLINED

    share_request.status = new_status
    share_request.responded_at = timezone.now()
    share_request.save(update_fields=["status", "responded_at"])
    return share_request, copy


def fork_document(document, section, actor, request=None):
    """Fork an existing document into a section without re-uploading (CR)."""
    from .models import Document

    if Document.objects.filter(
        public_id=document.public_id, section_id=section.id
    ).exists():
        raise ValidationError(
            {"detail": "This document is already available in that section."}
        )
    forked = Document.objects.create(
        title=document.title,
        description=document.description,
        submission_deadline=document.submission_deadline,
        file_name=document.file_name,
        file_size=document.file_size,
        cloudinary_url=document.cloudinary_url,
        public_id=document.public_id,
        branch=document.branch,
        section=section,
        semester=document.semester,
        category=document.category,
        subject=document.subject,
        uploaded_by=actor,
        forked_from=document,
        # Same file -> same extracted text (no re-OCR needed).
        ocr_status=document.ocr_status,
        ocr_text=document.ocr_text,
        ocr_error=document.ocr_error,
        ocr_updated_at=document.ocr_updated_at,
    )
    log_audit(
        actor, "DOCUMENT_FORK", "Document", document.id,
        {
            "title": document.title,
            "public_id": document.public_id,
            "section": section.name,
            "forked_id": forked.id,
        },
        request,
    )
    return forked


def delete_document_notifications(public_id: str) -> None:
    """Remove the 'new document' bell notifications that announced this file.

    Only called when the file is gone for good (last copy deleted) so the bell
    never points at a deleted document. Never raises - notification cleanup
    must not block the actual deletion.
    """
    try:
        from apps.core.models import Notification

        Notification.objects.filter(
            kind=Notification.Kind.DOCUMENT_UPLOAD,
            document_public_id=public_id,
        ).delete()
    except Exception:  # pragma: no cover
        pass


def delete_document(document, actor, request=None) -> None:
    """Delete the record; only delete the Cloudinary file when it is the last copy."""
    from .models import Document

    title = document.title
    public_id = document.public_id
    other_copies = Document.objects.filter(public_id=public_id).exclude(pk=document.pk).count()
    cloudinary_ok = None
    if other_copies == 0:
        cloudinary_ok = delete_document_file(public_id)
        delete_document_notifications(public_id)
    document.delete()
    log_audit(
        actor, "DOCUMENT_DELETE", "Document", title,
        {
            "title": title,
            "public_id": public_id,
            "cloudinary_deleted": cloudinary_ok,
            "remaining_copies": other_copies,
        },
        request,
    )
