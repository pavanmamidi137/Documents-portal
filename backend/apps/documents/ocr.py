"""Best-effort text extraction for document PDFs (assignments, lab manuals...).

The pipeline is credit-conscious:

* Text-based PDFs are read with pypdf - free, no AI call.
* Scanned/image PDFs are OCR'd through the AI Router (DOCUMENT_OCR task) and
  the token usage is charged to the college's Super Admin (documents are
  shared class resources - a student OCRing a class document must not drain
  their personal AI credits).

Every shared copy of the same file (multiple sections / forks share the
Cloudinary ``public_id``) gets the same text, so one extraction serves them all.
"""

import io
import os
import urllib.request

from django.utils import timezone

from apps.core import ocr as _core_ocr

# Cap the stored text so a giant manual can't bloat the row.
_MAX_OCR_TEXT_CHARS = 200_000


def _pypdf_text(content: bytes) -> str:
    """Plain text straight out of the PDF (free - no AI). Empty for scans."""
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(content))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception:
        return ""


def _set_ocr(document, status: str, text: str = "", error: str = "") -> None:
    """Persist the extraction result on this row AND every copy of the file
    (other sections / forks that share the same Cloudinary public_id)."""
    from .models import Document

    values = {
        "ocr_status": status,
        "ocr_text": text[:_MAX_OCR_TEXT_CHARS],
        "ocr_error": error[:300],
        "ocr_updated_at": timezone.now(),
    }
    Document.objects.filter(pk=document.pk).update(**values)
    Document.objects.filter(public_id=document.public_id).exclude(pk=document.pk).update(**values)


def _usage_owner(actor):
    """Document OCR is a shared/class resource - the college pays, not the
    student who clicked the button (matches the drive match-refresh policy)."""
    from apps.accounts.models import User

    admin = (
        User.objects.filter(role=User.Role.SUPER_ADMIN, is_active=True)
        .order_by("id")
        .first()
    )
    return admin or actor


def _usage_callback(actor):
    from apps.placements.models import AiUsageLog

    owner = _usage_owner(actor)

    def callback(prompt_tokens: int, completion_tokens: int) -> None:
        try:
            AiUsageLog.objects.create(
                user=owner, action=AiUsageLog.Action.DOC_OCR,
                prompt_tokens=int(prompt_tokens or 0),
                completion_tokens=int(completion_tokens or 0),
            )
        except Exception:  # pragma: no cover - usage tracking must never break extraction
            pass

    return callback


def extract_document_text(document, actor) -> dict:
    """Extract readable text from a document and store it on the row.

    Returns ``{"ocr_status", "ocr_text", "ocr_error"}`` and never raises.
    PDFs with a text layer are read directly (free); scanned PDFs are OCR'd
    via the AI router (charged to the college's admin).
    """
    from .services import signed_raw_url

    name = (document.file_name or "").lower()
    if not name.endswith(".pdf"):
        error = "Only PDF files can be read as text (re-save the file as PDF)."
        _set_ocr(document, "FAILED", "", error)
        return {"ocr_status": "FAILED", "ocr_text": "", "ocr_error": error}

    try:
        with urllib.request.urlopen(signed_raw_url(document.public_id), timeout=30) as resp:
            content = resp.read()
    except Exception:
        error = "Could not download the file from storage."
        _set_ocr(document, "FAILED", "", error)
        return {"ocr_status": "FAILED", "ocr_text": "", "ocr_error": error}

    text = _pypdf_text(content).strip()
    if not text:
        # Called through the module so the router call is patchable and stays
        # consistent with the shared OCR pipeline.
        text = _core_ocr.ocr_pdf_content(
            content,
            usage_callback=_usage_callback(actor),
            task="DOCUMENT_OCR",
            max_pages=max(1, int(os.environ.get("DOCUMENT_OCR_MAX_PAGES", "8"))),
        ).strip()
        if not text:
            error = (
                "This PDF has no readable text and automatic OCR could not read "
                "it. Upload a text-based PDF instead."
            )
            _set_ocr(document, "FAILED", "", error)
            return {"ocr_status": "FAILED", "ocr_text": "", "ocr_error": error}

    _set_ocr(document, "COMPLETE", text, "")
    return {"ocr_status": "COMPLETE", "ocr_text": text, "ocr_error": ""}
