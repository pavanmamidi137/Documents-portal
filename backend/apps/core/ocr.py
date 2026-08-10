"""Shared OCR for scanned/image PDFs (resumes, documents, lab manuals...).

The text-extraction pipeline used by both the resume AI review and document
text extraction:

    pdf_to_page_images(content)  -> base64 PNG data URIs (PyMuPDF render)
    ocr_pdf_content(content)     -> transcribed text via a vision-capable AI

Both helpers are pure and fail-safe (return [] / "" on any failure) so the
callers decide how to surface the outcome. Credits are NOT tracked here - the
caller passes a usage_callback when it wants the call charged to a user.
"""

import base64
import os
import re

_MAX_DEFAULT_PAGES = 6
_MAX_IMAGE_BYTES = 4_500_000


def pdf_to_page_images(content: bytes, max_pages: int | None = None,
                        dpi: int | None = None) -> list[str]:
    """Render PDF pages to base64 image data URIs for vision-capable models.

    Scanned resumes are typically 1-2 pages; the cap keeps the OCR call cheap.
    Oversized page renders are skipped so the request stays lean. Returns an
    empty list when the PDF cannot be rendered (never raises).
    """
    if max_pages is None:
        max_pages = max(1, int(os.environ.get("OCR_MAX_PAGES", str(_MAX_DEFAULT_PAGES))))
    if dpi is None:
        dpi = max(72, int(os.environ.get("OCR_DPI", "170")))
    try:
        import fitz  # PyMuPDF (already a dependency)

        doc = fitz.open(stream=content, filetype="pdf")
    except Exception:
        return []
    try:
        # PyMuPDF exposes pages as a property in older releases and a method
        # (``doc.pages()``) in newer ones - handle both so the render never
        # crashes on a real scanned PDF.
        pages = doc.pages() if callable(doc.pages) else doc.pages
        uris: list[str] = []
        for page in pages:
            if len(uris) >= max_pages:
                break
            try:
                # alpha=False keeps the PNG as plain RGB - more widely accepted
                # by vision providers and slightly smaller than RGBA.
                pix = page.get_pixmap(dpi=dpi, alpha=False)
                png = pix.tobytes("png")
            except Exception:
                continue
            if not png or len(png) > _MAX_IMAGE_BYTES:
                continue
            uris.append("data:image/png;base64," + base64.b64encode(png).decode("ascii"))
        return uris
    except Exception:
        return []
    finally:
        doc.close()


_OCR_SYSTEM_PROMPT = """\
You are a precise OCR engine. Transcribe ALL the text from the document image(s) \
exactly as written, preserving order and line structure as best you can. \
Output ONLY the transcribed text - no commentary, no headers, no markdown. \
If an image contains no readable text, output exactly: NO TEXT"""


def ocr_pdf_content(content: bytes, usage_callback=None, task: str = "DOCUMENT_OCR",
                    max_tokens: int = 4096, max_pages: int | None = None,
                    dpi: int | None = None) -> str:
    """Transcribe a scanned PDF's pages with a vision-capable AI provider.

    Returns "" (never raises) when OCR is unavailable - no AI provider
    configured, or no vision-capable model - so callers fail gracefully
    without charging credits. ``task`` selects the router provider chain
    (RESUME_OCR / DOCUMENT_OCR).
    """
    if not content:
        return ""
    images = pdf_to_page_images(content, max_pages=max_pages, dpi=dpi)
    if not images:
        return ""
    try:
        # Lazy import so tests can patch the router's AIService directly and to
        # avoid a module-level import cycle (placements imports core utils).
        from apps.placements.ai_router import AIService

        text = AIService.generate(
            task=task,
            system_prompt=_OCR_SYSTEM_PROMPT,
            user_text=(
                "The attached images are pages of a scanned document. "
                "Transcribe all the text you can read."
            ),
            max_tokens=max_tokens,
            temperature=0,
            images=images,
            cacheable=False,
            usage_callback=usage_callback,
        )
    except Exception:  # OCR must never break the request - fail gracefully
        return ""
    text = str(text or "").strip()
    # The model is told to output exactly "NO TEXT" for blank pages - treat
    # that (and empty/symbol-only output) as an OCR failure so a blank page
    # never reaches the quality model (which would still charge credits).
    if not text:
        return ""
    stripped = re.sub(r"[^A-Za-z0-9]", "", text).lower()
    if stripped in ("", "notext"):
        return ""
    return text
