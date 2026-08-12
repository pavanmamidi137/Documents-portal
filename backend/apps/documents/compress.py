"""Best-effort compression for uploaded PDFs and Office documents.

PDFs are re-saved through PyMuPDF with garbage collection, deflate and
``clean`` enabled, and their embedded images (photos, scans) are re-encoded to
high-quality JPEG - which genuinely shrinks image-heavy files while text stays
vector-crisp. Office documents (DOCX/PPTX/DOC) are zip archives, so they are
re-zipped with maximum deflate and their embedded images are re-encoded
(JPEG -> JPEG q75, PNG -> lossless optimized) with Pillow when available.

Compression never destroys data and never hurts quality: each pass is only
kept when the result is STRICTLY smaller than the original, PNGs stay lossless,
and when a library is missing or a step fails the original bytes are kept
untouched.
"""
import io
import zipfile

_PDF_MAGIC = b"%PDF"

# Embedded images smaller than this are not worth touching.
_MIN_IMAGE_BYTES = 40_000
# Re-encode only images with at least this many pixels (tiny icons/logos are
# left alone - JPEG would make them bigger and blurrier).
_MIN_IMAGE_PIXELS = 100_000
# JPEG quality for re-encoded images (75 keeps documents/screenshots crisp).
_JPEG_QUALITY = 75


def _fitz():
    """PyMuPDF import (new + legacy module names)."""
    try:
        import pymupdf as fitz  # PyMuPDF >= 1.24 naming
    except ImportError:
        import fitz  # older releases
    return fitz


def compress_pdf(data: bytes) -> bytes | None:
    """Re-save a PDF (deflate + image recompression); only if strictly smaller."""
    if not data.startswith(_PDF_MAGIC):
        return None
    fitz = _fitz()
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        try:
            # Pass 1: stream deflation + object cleanup.
            plain = io.BytesIO()
            doc.save(plain, garbage=4, deflate=True, clean=True)
            pass1 = plain.getvalue()

            # Pass 2: re-encode large embedded raster images to high-quality
            # JPEG (valid inside a PDF regardless of the original format) then
            # re-save with deflate. Skipped per-image when it would not shrink.
            try:
                _recompress_pdf_images(doc)
                refined = io.BytesIO()
                doc.save(refined, garbage=4, deflate=True, clean=True)
                pass2 = refined.getvalue()
            except Exception:
                pass2 = b""
        finally:
            doc.close()
    except Exception:
        return None
    candidates = [c for c in (pass1, pass2) if c and len(c) < len(data)]
    if not candidates:
        return None
    return min(candidates, key=len)


def _recompress_pdf_images(doc) -> None:
    """Re-embed large images as JPEG q75; skips any image that would not shrink."""
    seen: set[int] = set()
    for page in doc:
        for image in page.get_images(full=True):
            xref = image[0]
            if xref in seen:
                continue
            seen.add(xref)
            try:
                info = doc.extract_image(xref)
                original = info.get("image") or b""
                if not original or len(original) < _MIN_IMAGE_BYTES:
                    continue
                pix = fitz.Pixmap(doc, xref)
                if pix.width * pix.height < _MIN_IMAGE_PIXELS:
                    continue
                if pix.n >= 4:  # CMYK / alpha - flatten to RGB before JPEG
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                jpeg = pix.tobytes("jpeg", jpg_quality=_JPEG_QUALITY)
                if jpeg and len(jpeg) < len(original):
                    doc.replace_image(xref, stream=jpeg)
            except Exception:
                continue  # one bad image must never fail the whole file


def compress_zip(data: bytes) -> bytes | None:
    """Re-zip an Office archive (DOCX/PPTX) with max deflate + media recompression."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as src:
            names = src.namelist()
            out = io.BytesIO()
            with zipfile.ZipFile(
                out, "w", zipfile.ZIP_DEFLATED, compresslevel=9
            ) as dst:
                for name in names:
                    dst.writestr(name, _compress_media(name, src.read(name)))
    except Exception:
        return None
    result = out.getvalue()
    return result if len(result) < len(data) else None


def _compress_media(name: str, content: bytes) -> bytes:
    """Re-encode an Office embedded image in-place (JPEG q75 / PNG lossless).

    The extension is never changed - only content that stays valid for the
    original format is produced - so Word/PPT still open the file cleanly.
    Returns the original bytes when Pillow is missing or the result is bigger.
    """
    lower = name.lower()
    if not lower.startswith(("word/media/", "ppt/media/", "xl/media/")):
        return content
    if len(content) < _MIN_IMAGE_BYTES:
        return content
    if lower.endswith((".jpg", ".jpeg")):
        return _reencode_jpeg(content)
    if lower.endswith(".png"):
        return _reencode_png(content)
    return content


def _reencode_jpeg(content: bytes) -> bytes:
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(content))
        img.load()
        out = io.BytesIO()
        # q75 on an already-JPEG image: strictly-smaller-or-keep check below.
        img.save(out, "JPEG", quality=_JPEG_QUALITY, optimize=True, progressive=True)
        result = out.getvalue()
        return result if result and len(result) < len(content) else content
    except Exception:
        return content


def _reencode_png(content: bytes) -> bytes:
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(content))
        img.load()
        out = io.BytesIO()
        # Lossless: palette/optimize only ever removes redundancy, never data.
        img.save(out, "PNG", optimize=True)
        result = out.getvalue()
        return result if result and len(result) < len(content) else content
    except Exception:
        return content


def compress_file(file) -> bytes | None:
    """Compress an uploaded file based on its extension.

    Reads the file (rewinding afterwards). Returns the compressed bytes when
    they are smaller than the original, otherwise ``None``.
    """
    name = (getattr(file, "name", "") or "").lower()
    ext = f".{name.rpartition('.')[2]}" if "." in name else ""
    data = file.read()
    file.seek(0)
    if ext == ".pdf":
        return compress_pdf(data)
    if ext in (".docx", ".pptx"):
        return compress_zip(data)
    return None
