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
    """Upload the document and persist the record."""
    folder = build_folder(
        data["branch"], data["section"], data["semester"],
        data["category"], data["subject"],
    )
    uploaded = upload_document(document_file, folder)

    from .models import Document

    document = Document.objects.create(
        title=data["title"].strip(),
        description=data.get("description", "").strip(),
        file_name=uploaded["file_name"],
        file_size=uploaded["file_size"],
        cloudinary_url=uploaded["url"],
        public_id=uploaded["public_id"],
        branch=data["branch"],
        section=data["section"],
        semester=data["semester"],
        category=data["category"],
        subject=data["subject"],
        uploaded_by=actor,
    )
    log_audit(
        actor, "DOCUMENT_UPLOAD", "Document", document.id,
        {
            "title": document.title,
            "public_id": document.public_id,
            "branch": document.branch.name,
            "section": document.section.name,
            "semester": document.semester.name,
            "category": document.category.name,
            "subject": document.subject.name,
        },
        request,
    )
    return document


def delete_document(document, actor, request=None) -> None:
    """Delete the Cloudinary file, then the record."""
    title = document.title
    public_id = document.public_id
    cloudinary_ok = delete_document_file(public_id)
    document.delete()
    log_audit(
        actor, "DOCUMENT_DELETE", "Document", title,
        {"title": title, "cloudinary_deleted": cloudinary_ok, "public_id": public_id},
        request,
    )
