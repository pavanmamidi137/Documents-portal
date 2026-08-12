"""Best-effort compression for uploaded PDFs and Office documents.

PDFs are re-saved through PyMuPDF with garbage collection, deflate and
``clean`` enabled, and their embedded images (photos, scans) are re-encoded to
high-quality JPEG - which genuinely shrinks image-heavy files while text stays
vector-crisp. Office documents (DOCX/PPTX) are zip archives, so they are
re-zipped with maximum deflate and their embedded images are re-encoded
(JPEG -> JPEG, PNG -> lossless optimized) with Pillow when available.

Compression is TARGET-AWARE: ``compress_file`` accepts the size cap the final
file must fit under (e.g. the 9MB document limit), and the compressors keep
trying progressively more aggressive passes - a quality ladder (75 -> 30) plus
downscaling very large scans - until the result fits the target, only ever
keeping a pass that is strictly smaller than the original. When a library is
missing or a step fails, the original bytes are kept untouched and ``None`` is
returned so the caller can reject the file with a clear message.
"""
import io
import zipfile

_PDF_MAGIC = b"%PDF"

# Embedded images smaller than this are not worth touching.
_MIN_IMAGE_BYTES = 40_000
# Re-encode only images with at least this many pixels (tiny icons/logos are
# left alone - JPEG would make them bigger and blurrier).
_MIN_IMAGE_PIXELS = 100_000
# Progressive JPEG quality ladder. Later steps are only tried when the file
# still does not fit under the target size, so the lightest touch is always
# preferred and quality is only traded when it is required to fit.
_JPEG_QUALITY_LADDER = (75, 60, 45, 30)
# Scans/photos with a side longer than this are downscaled by half in the
# final aggressive pass only - readable on screen but much smaller.
_MAX_SCAN_SIDE = 4000


def _fitz():
    """PyMuPDF import (new + legacy module names)."""
    try:
        import pymupdf as fitz  # PyMuPDF >= 1.24 naming
    except ImportError:
        import fitz  # older releases
    return fitz


def _fits(candidate: bytes | None, target_bytes: int | None) -> bool:
    """True when the candidate is present and under the target cap."""
    return candidate is not None and (
        target_bytes is None or len(candidate) <= target_bytes
    )


def compress_pdf(data: bytes, target_bytes: int | None = None) -> bytes | None:
    """Re-save a PDF, trying harder passes until it fits ``target_bytes``.

    Pass 1 re-saves with deflate + cleanup. Then, while the result is still
    over the target, embedded images are re-encoded at progressively lower
    quality (75 -> 60 -> 45 -> 30); the final aggressive pass also halves any
    very large scan. Only strictly-smaller results are ever kept.
    """
    if not data.startswith(_PDF_MAGIC):
        return None
    fitz = _fitz()
    best: bytes | None = None
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        try:
            # Pass 1: stream deflation + object cleanup.
            plain = io.BytesIO()
            doc.save(plain, garbage=4, deflate=True, clean=True)
            pass1 = plain.getvalue()
            if len(pass1) < len(data):
                best = pass1
                if _fits(best, target_bytes):
                    return best

            # Passes 2..n: re-encode large embedded raster images at lower
            # quality (the last step also halves oversized scans). Each pass is
            # only kept when it is strictly smaller; the first one that fits
            # the target wins immediately.
            for quality in _JPEG_QUALITY_LADDER:
                try:
                    _recompress_pdf_images(
                        doc,
                        quality,
                        downscale=quality == _JPEG_QUALITY_LADDER[-1],
                    )
                    refined = io.BytesIO()
                    doc.save(refined, garbage=4, deflate=True, clean=True)
                    cand = refined.getvalue()
                except Exception:
                    cand = b""
                if cand and len(cand) < len(data):
                    best = cand
                    if _fits(best, target_bytes):
                        return best
        finally:
            doc.close()
    except Exception:
        return None
    return best


def _recompress_pdf_images(doc, quality: int, downscale: bool = False) -> None:
    """Re-embed large images as JPEG at the given quality.

    Skips any image that would not shrink. When ``downscale`` is set, images
    with a side longer than ``_MAX_SCAN_SIDE`` are halved first (aggressive
    final pass for huge scans).

    Note: newer PyMuPDF versions (>= 1.24) removed ``Document.replace_image``;
    the image stream is replaced directly with ``Document.update_stream``,
    which is compatible with every recent release and re-links the existing
    image xref to the new (smaller) JPEG.
    """
    fitz = _fitz()
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
                # Only JPEG (DCTDecode) images may have their stream swapped
                # for a new JPEG: ``update_stream`` replaces the raw bytes but
                # does NOT rewrite the image's /Filter entry, so a JPEG under
                # a FlateDecode/PNG filter would corrupt rendering. Skips
                # every other source format (it keeps the original bytes).
                if (info.get("ext") or "").lower() != "jpeg":
                    continue
                pix = fitz.Pixmap(doc, xref)
                if pix.width * pix.height < _MIN_IMAGE_PIXELS:
                    continue
                if downscale and max(pix.width, pix.height) > _MAX_SCAN_SIDE:
                    pix = pix.shrink(2)  # half dimensions
                if pix.n >= 4:  # CMYK / alpha - flatten to RGB before JPEG
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                jpeg = pix.tobytes("jpeg", jpg_quality=quality)
                if jpeg and len(jpeg) < len(original):
                    doc.update_stream(xref, jpeg)
            except Exception:
                continue  # one bad image must never fail the whole file


def compress_zip(data: bytes, target_bytes: int | None = None) -> bytes | None:
    """Re-zip an Office archive (DOCX/PPTX) with max deflate + media passes.

    Pass 1 re-zips everything at maximum deflate with q75 media. If the result
    is still over the target, embedded JPEGs are re-encoded at progressively
    lower quality (and oversized media halved in the final aggressive pass).
    Only strictly-smaller results are kept.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as src:
            names = src.namelist()
            contents = [(n, src.read(n)) for n in names]
    except Exception:
        return None

    best: bytes | None = None
    for step, quality in enumerate(_JPEG_QUALITY_LADDER):
        downscale = step == len(_JPEG_QUALITY_LADDER) - 1
        try:
            out = io.BytesIO()
            with zipfile.ZipFile(
                out, "w", zipfile.ZIP_DEFLATED, compresslevel=9
            ) as dst:
                for name, content in contents:
                    dst.writestr(name, _compress_media(name, content, quality, downscale))
            cand = out.getvalue()
        except Exception:
            cand = b""
        if cand and len(cand) < len(data):
            best = cand
            if _fits(best, target_bytes):
                return best
    return best


def _compress_media(
    name: str, content: bytes, quality: int, downscale: bool = False
) -> bytes:
    """Re-encode an Office embedded image in-place (JPEG / PNG lossless).

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
        return _reencode_jpeg(content, quality, downscale)
    if lower.endswith(".png"):
        return _reencode_png(content)
    return content


def _reencode_jpeg(content: bytes, quality: int, downscale: bool = False) -> bytes:
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(content))
        img.load()
        if downscale and max(img.size) > _MAX_SCAN_SIDE:
            ratio = _MAX_SCAN_SIDE / max(img.size)
            img = img.resize(
                (max(1, round(img.width * ratio)), max(1, round(img.height * ratio))),
                Image.LANCZOS,
            )
        out = io.BytesIO()
        img.save(out, "JPEG", quality=quality, optimize=True, progressive=True)
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


def compress_file(file, target_bytes: int | None = None) -> bytes | None:
    """Compress an uploaded file based on its extension, trying to fit ``target_bytes``.

    Reads the file (rewinding afterwards). Returns the compressed bytes when
    they are smaller than the original, otherwise ``None``. OLE-binary formats
    (``.ppt`` / ``.doc``) are not recompressible without Office tooling, so
    they return ``None`` and the caller rejects them with a clear message.
    """
    name = (getattr(file, "name", "") or "").lower()
    ext = f".{name.rpartition('.')[2]}" if "." in name else ""
    data = file.read()
    file.seek(0)
    if ext == ".pdf":
        return compress_pdf(data, target_bytes)
    if ext in (".docx", ".pptx"):
        return compress_zip(data, target_bytes)
    return None
