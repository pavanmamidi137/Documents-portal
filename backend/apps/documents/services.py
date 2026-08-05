"""Document upload lifecycle.

PDFs go to Cloudinary as RAW files under:
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


def validate_pdf(pdf_file) -> None:
    """Reject non-PDF files and files over the size limit.

    Checks the client-supplied content type/extension AND the file's magic
    bytes ("%PDF-"), so a renamed HTML/JS file cannot be stored and previewed.
    """
    if not pdf_file:
        raise ValidationError({"file": "A PDF file is required."})
    if pdf_file.size <= 0:
        raise ValidationError({"file": "The uploaded file is empty."})

    content_type = (getattr(pdf_file, "content_type", "") or "").lower()
    name = (getattr(pdf_file, "name", "") or "").lower()
    if content_type != "application/pdf" and not name.endswith(".pdf"):
        raise ValidationError({"file": "Only PDF files are allowed."})

    # Magic-byte check: the first 5 bytes of every PDF are "%PDF-".
    header = pdf_file.read(5)
    pdf_file.seek(0)
    if header != b"%PDF-":
        raise ValidationError({"file": "The file is not a valid PDF."})

    max_bytes = settings.MAX_PDF_SIZE_MB * 1024 * 1024
    if pdf_file.size > max_bytes:
        raise ValidationError(
            {"file": f"File exceeds the {settings.MAX_PDF_SIZE_MB}MB size limit."}
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


def upload_pdf(pdf_file, folder: str) -> dict:
    """Upload a validated PDF to Cloudinary and return its references."""
    validate_pdf(pdf_file)
    try:
        result = cloudinary.uploader.upload(
            pdf_file,
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
        "file_name": pdf_file.name,
        "file_size": pdf_file.size,
    }


def delete_pdf(public_id: str) -> bool:
    """Remove a raw file from Cloudinary. Returns False on failure."""
    try:
        cloudinary.api.delete_resources([public_id], resource_type="raw")
        return True
    except Exception:
        return False


def create_document(data: dict, pdf_file, actor, request=None):
    """Upload the PDF and persist the document record."""
    folder = build_folder(
        data["branch"], data["section"], data["semester"],
        data["category"], data["subject"],
    )
    uploaded = upload_pdf(pdf_file, folder)

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
    cloudinary_ok = delete_pdf(public_id)
    document.delete()
    log_audit(
        actor, "DOCUMENT_DELETE", "Document", title,
        {"title": title, "cloudinary_deleted": cloudinary_ok, "public_id": public_id},
        request,
    )
