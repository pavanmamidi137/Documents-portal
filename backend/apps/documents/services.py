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
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.utils import log_audit, slugify

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

    content_type = (getattr(document_file, "content_type", "") or "").lower()
    name = (getattr(document_file, "name", "") or "").lower()
    _, _, ext_part = name.rpartition(".")
    ext = f".{ext_part}" if ext_part else ""

    allowed = ALLOWED_DOCUMENT_TYPES.get(ext)
    if not allowed:
        raise ValidationError({"file": "Only PDF, PPT, PPTX, DOC, DOCX or TXT files are allowed."})

    magic, content_types = allowed
    if content_types and content_type and content_type not in content_types:
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

    max_bytes = settings.MAX_DOCUMENT_SIZE_MB * 1024 * 1024
    if document_file.size > max_bytes:
        raise ValidationError(
            {"file": f"File exceeds the {settings.MAX_DOCUMENT_SIZE_MB}MB size limit."}
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


def upload_document(document_file, folder: str) -> dict:
    """Upload a validated document to Cloudinary and return its references."""
    validate_document(document_file)
    try:
        result = cloudinary.uploader.upload(
            document_file,
            resource_type="raw",
            folder=folder,
            use_filename=True,
            unique_filename=True,
            overwrite=False,
        )
    except Exception as exc:  # network / API errors bubble up as a 400
        raise ValidationError({"file": f"Cloudinary upload failed: {exc}"})
    return {
        "url": result["secure_url"],
        "public_id": result["public_id"],
        "file_name": document_file.name,
        "file_size": document_file.size,
    }


def delete_document_file(public_id: str) -> bool:
    """Remove a raw file from Cloudinary. Returns False on failure."""
    try:
        cloudinary.api.delete_resources([public_id], resource_type="raw")
        return True
    except Exception:
        return False


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
    return primary


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


def delete_document(document, actor, request=None) -> None:
    """Delete the record; only delete the Cloudinary file when it is the last copy."""
    from .models import Document

    title = document.title
    public_id = document.public_id
    other_copies = Document.objects.filter(public_id=public_id).exclude(pk=document.pk).count()
    cloudinary_ok = None
    if other_copies == 0:
        cloudinary_ok = delete_document_file(public_id)
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
