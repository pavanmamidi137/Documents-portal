"""Best-effort compression for uploaded PDFs and Office documents.

PDFs are re-saved through PyMuPDF with garbage collection, deflate and
``clean`` enabled, which genuinely shrinks text-heavy and image-heavy files.
Office documents (DOCX/PPTX/DOC) are zip archives, so they are re-zipped with
maximum deflate. Compression never destroys data: when the library is missing
or the result is not smaller, ``None`` is returned and the original file is
kept untouched.
"""
import io
import zipfile

_PDF_MAGIC = b"%PDF"


def compress_pdf(data: bytes) -> bytes | None:
    """Re-save a PDF via PyMuPDF; returns bytes only when strictly smaller."""
    if not data.startswith(_PDF_MAGIC):
        return None
    try:
        import pymupdf as fitz  # PyMuPDF >= 1.24 naming
    except ImportError:
        try:
            import fitz  # older releases
        except ImportError:
            return None
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        try:
            out = io.BytesIO()
            doc.save(out, garbage=4, deflate=True, clean=True)
        finally:
            doc.close()
    except Exception:
        return None
    result = out.getvalue()
    return result if len(result) < len(data) else None


def compress_zip(data: bytes) -> bytes | None:
    """Re-zip an Office archive (DOCX/PPTX) with maximum deflate."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as src:
            names = src.namelist()
            out = io.BytesIO()
            with zipfile.ZipFile(
                out, "w", zipfile.ZIP_DEFLATED, compresslevel=9
            ) as dst:
                for name in names:
                    dst.writestr(name, src.read(name))
    except Exception:
        return None
    result = out.getvalue()
    return result if len(result) < len(data) else None


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
