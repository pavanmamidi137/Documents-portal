"""AI analysis of student resumes: quality feedback + per-drive match chances.

Runs against the NVIDIA-powered client in ``.ai`` (``ai_json``) and caches the
result on the ``Resume`` row. Students trigger it from their resume page; once
faculty mark a resume as reviewed the quality report is unlocked for the
student. The same run also snapshots a match score against every open drive, so
students can see which drives give them the best chance.
"""

import html
import io
import re
import zipfile

from django.utils import timezone

from .ai import AiError, ai_json
from .models import AiUsageLog, Drive

# Cap the resume text sent to the model - resumes are short, so this keeps the
# prompt cheap even for oddly long files.
_MAX_TEXT_CHARS = 15000

_QUALITY_PROMPT = """\
You are a career advisor reviewing a college student's resume for campus placements.
Return ONLY valid JSON (no markdown, no comments) with exactly these keys:
- score: integer 0-100 overall quality
- summary: one or two sentences on the resume's overall impression
- strengths: array of 3-5 short strings - what stands out (projects, skills, format, achievements)
- improvements: array of 3-5 short strings - what would make it stronger (quantify results, add ATS keywords, fix layout)
- skills: array of strings - every skill/keyword mentioned (languages, tools, frameworks, soft skills)
- ats_keywords: array of strings - important ATS keywords for IT/fresher roles that are MISSING from this resume (e.g. Python, SQL, Git, communication, teamwork)
Be specific and honest. If the resume text is unreadable or empty, still return the JSON
with score 0 and a note in summary that the text could not be extracted."""

_MATCH_PROMPT = """\
You match a student's resume against open placement drives and estimate how likely they are to be shortlisted.
Return ONLY valid JSON (no markdown, no comments) with a single key "matches": an array of objects with keys:
- drive_id: number (the id of the drive)
- score: integer 0-100 match strength
- reason: one short sentence explaining the fit (skills / role / eligibility / package)
Base the match on the resume's skills and each drive's role, eligibility and eligible roll numbers.
Only include drives from the list provided. Do not invent drives or ids.

Resume summary & skills:
{resume_brief}

Open drives:
{drives}"""


def _usage_callback(actor):
    """Record one AI call's token counts for the credits page (never raises)."""

    def callback(prompt_tokens: int, completion_tokens: int) -> None:
        try:
            AiUsageLog.objects.create(
                user=actor, action=AiUsageLog.Action.RESUME,
                prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
            )
        except Exception:  # pragma: no cover - usage tracking must never break the request
            pass

    return callback


def extract_resume_text(resume) -> str:
    """Download the resume from Cloudinary and pull plain text out of it.

    PDFs are parsed with pypdf; DOCX is a ZIP of XML so the stdlib handles it;
    legacy DOC is a binary format and returns ''. Returns '' whenever the file
    can't be read, so callers degrade gracefully instead of failing the review.
    """
    import urllib.request

    from apps.documents.services import signed_raw_url

    name = (resume.file_name or "").lower()
    try:
        with urllib.request.urlopen(signed_raw_url(resume.public_id), timeout=30) as resp:
            content = resp.read()
    except Exception:
        return ""
    try:
        if name.endswith(".pdf"):
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(content))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        if name.endswith(".docx"):
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                xml = zf.read("word/document.xml").decode("utf-8", errors="ignore")
            # Paragraphs become line breaks, then strip every remaining tag.
            text = re.sub(r"<w:p[ >]", "\n", xml)
            text = re.sub(r"<[^>]+>", "", text)
            return html.unescape(text)
        if name.endswith(".txt"):
            return content.decode("utf-8", errors="replace")
    except Exception:
        return ""
    return ""


def _clamp_score(value) -> int:
    try:
        return max(0, min(100, int(value)))
    except (TypeError, ValueError):
        return 0


def _string_list(value, limit: int) -> list[str]:
    items = value if isinstance(value, list) else []
    out: list[str] = []
    for item in items:
        text = str(item).strip()
        if text and text not in out:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def analyze_resume(resume, actor) -> dict:
    """Run the full analysis (quality + drive matches) and store it on the resume.

    Raises AiError when the AI service itself fails (the caller surfaces a 502).
    The result is cached on the Resume row - re-running only happens on request.
    """
    from apps.accounts.models import Resume

    from apps.core.models import Notification
    from apps.core.utils import notify

    usage = _usage_callback(actor)
    text = extract_resume_text(resume)
    brief = (text or "(no extractable text)").strip()[:_MAX_TEXT_CHARS]

    try:
        quality = ai_json(
            _QUALITY_PROMPT, brief, max_tokens=1400, usage_callback=usage
        )
    except AiError:
        raise

    analysis = None
    if isinstance(quality, dict) and quality:
        analysis = {
            "summary": str(quality.get("summary") or "").strip(),
            "strengths": _string_list(quality.get("strengths"), 6),
            "improvements": _string_list(quality.get("improvements"), 6),
            "skills": _string_list(quality.get("skills"), 20),
            "ats_keywords": _string_list(quality.get("ats_keywords"), 12),
        }

    match_map: dict[str, dict] = {}
    if text:
        open_drives = list(
            Drive.objects.filter(
                last_date_to_apply__gte=timezone.localdate()
            ).order_by("-created_at")[:20]
        )
        if open_drives:
            drives_brief = "\n".join(
                f"- id {d.id}: {d.company_name} ({d.role or 'role not mentioned'}, "
                f"{d.package or 'package not mentioned'}). Eligibility: "
                f"{d.eligibility or 'not mentioned'}"
                for d in open_drives
            )
            try:
                match = ai_json(
                    _MATCH_PROMPT.format(resume_brief=brief[:4000], drives=drives_brief),
                    "Score this resume against each drive.", max_tokens=1600,
                    usage_callback=usage,
                )
            except AiError:
                raise
            if isinstance(match, dict) and isinstance(match.get("matches"), list):
                by_id = {d.id: d for d in open_drives}
                for entry in match["matches"]:
                    if not isinstance(entry, dict):
                        continue
                    try:
                        drive_id = int(entry.get("drive_id"))
                    except (TypeError, ValueError):
                        continue
                    drive = by_id.get(drive_id)
                    if drive is None:
                        continue
                    match_map[str(drive_id)] = {
                        "score": _clamp_score(entry.get("score")),
                        "reason": str(entry.get("reason") or "").strip()[:300],
                        "company_name": drive.company_name,
                    }

    was_complete = resume.ai_status == Resume.AiStatus.COMPLETE
    if analysis or match_map:
        resume.ai_status = Resume.AiStatus.COMPLETE
        resume.ai_score = _clamp_score(quality.get("score")) if analysis else 0
        resume.ai_analysis = analysis
        resume.ai_match = match_map or None
        resume.ai_error = ""
        resume.ai_analyzed_at = timezone.now()
    else:
        # The AI answered but produced nothing usable - surface as a failure
        # so the student sees the error state instead of a silent blank.
        resume.ai_status = Resume.AiStatus.FAILED
        resume.ai_score = None
        resume.ai_analysis = None
        resume.ai_match = None
        resume.ai_error = "The AI could not read this resume. Try a text-based PDF."
        resume.ai_analyzed_at = timezone.now()
    resume.save(update_fields=[
        "ai_status", "ai_score", "ai_analysis", "ai_match", "ai_error",
        "ai_analyzed_at", "updated_at",
    ])

    # Only the first completed analysis rings the bell - re-runs just refresh
    # the cached report silently.
    if resume.ai_status == Resume.AiStatus.COMPLETE and not was_complete:
        notify(
            [resume.student],
            Notification.Kind.AI_RESUME,
            "Your resume AI review is ready",
            "See your resume quality score and which open drives match you best.",
            "/resume",
        )
    return {
        "ai_status": resume.ai_status,
        "ai_score": resume.ai_score,
        "ai_analysis": resume.ai_analysis,
        "ai_match": resume.ai_match,
        "ai_error": resume.ai_error,
    }
