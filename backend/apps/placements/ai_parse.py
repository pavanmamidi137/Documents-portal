"""Robust parsing of AI model responses for JSON-requiring tasks.

Models are asked to return JSON, but in practice they wrap it in markdown
fences (```json ... ```), surround it with prose, truncate mid-object, return
an array instead of an object, or rename keys (camelCase / sentence case).
These helpers make the resume-analysis and drive-match parsing tolerant of all
of that without ever raising - an unusable answer comes back as ``{}`` / ``[]``
so callers can treat it as a failed attempt (no credits charged).

All functions here are pure and provider-agnostic; nothing in this module
touches the network or any provider configuration.
"""

import json
import re


def _strip_markdown_fences(text: str) -> str:
    """Remove ```json / ``` code fences wherever they appear (not only at the
    very start/end - some models wrap the JSON between prose)."""
    # ```json\n ... \n```  (case-insensitive 'json' tag)
    text = re.sub(r"```(?:json)?\s*\n?", "", text, flags=re.IGNORECASE)
    # Any stray backticks left behind.
    return text.replace("```", "").strip()


def _first_balanced_object(text: str) -> str:
    """Return the first balanced {...} object in the text, honouring string
    contents and escapes so a '}' inside a string doesn't end the object.
    Returns "" when no complete object is present (e.g. truncated output)."""
    start = text.find("{")
    while start != -1:
        depth = 0
        in_string = False
        escaped = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
            elif ch == '"':
                in_string = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]
        # Never found a balanced close - try the next '{'.
        start = text.find("{", start + 1)
    return ""


def _coerce_dict(parsed) -> dict:
    """A dict is returned as-is; an array is searched for its first dict."""
    if isinstance(parsed, dict):
        return parsed
    if isinstance(parsed, list):
        for item in parsed:
            if isinstance(item, dict):
                return item
    return {}


def extract_json_object(raw) -> dict:
    """Parse a JSON object from a model answer. Returns {} when nothing usable.

    Tolerates markdown fences, surrounding prose, a leading array, truncated
    trailing content and duplicated/extra JSON blocks (the first complete
    object wins).
    """
    if isinstance(raw, dict):
        return raw
    if not raw or not isinstance(raw, str):
        return {}
    text = _strip_markdown_fences(raw)

    # Fast path: the whole trimmed answer is a single JSON value.
    try:
        parsed = json.loads(text)
        return _coerce_dict(parsed)
    except (json.JSONDecodeError, TypeError):
        pass

    # The answer may start with prose before the JSON - walk forward to each
    # object start and parse the complete block (string-aware balancing).
    candidate = _first_balanced_object(text)
    if candidate:
        try:
            parsed = json.loads(candidate)
            return _coerce_dict(parsed)
        except (json.JSONDecodeError, TypeError):
            pass

    # The answer may be an array without a top-level object (e.g. the model
    # returned a list of matches). Try parsing the array and grabbing its
    # first dict element.
    array_start = text.find("[")
    if array_start != -1:
        try:
            parsed = json.loads(text[array_start:])
            if isinstance(parsed, list):
                for item in parsed:
                    if isinstance(item, dict):
                        return item
        except (json.JSONDecodeError, TypeError):
            pass
    return {}


def _lookup(data: dict, *names):
    """Case-insensitive value lookup with a list of candidate key names."""
    if not isinstance(data, dict):
        return None
    lowered = {str(k).lower(): v for k, v in data.items()}
    for name in names:
        if name in data and data[name] is not None:
            return data[name]
        for key, value in lowered.items():
            if key.replace("_", "").replace(" ", "") == name.replace("_", "").replace(" ", "") \
                    and value is not None:
                return value
    return None


def _as_str_list(value, limit: int) -> list[str]:
    """Coerce a field to a list of strings. Accepts a list, a tuple, or a
    single comma/semicolon/newline-separated string (models sometimes join
    items into one sentence)."""
    if value is None:
        return []
    if isinstance(value, str):
        items = re.split(r"[,;•|\n]+", value)
    elif isinstance(value, (list, tuple)):
        items = value
    else:
        return []
    out: list[str] = []
    for item in items:
        text = str(item).strip().lstrip("-*• ").strip()
        if text and text not in out:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def _as_score(value) -> int:
    try:
        score = int(round(float(value)))
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, score))


# The exact keys the resume report expects (as defined in the prompt).
RESUME_REPORT_KEYS = ("score", "summary", "strengths", "improvements", "skills", "ats_keywords")


def normalize_resume_report(raw) -> dict | None:
    """Validate + normalize the quality-report object a model returned.

    Returns a dict with exactly the expected keys, or None when the response
    carried no usable report at all (missing everything / not a dict). Key
    names are matched case-insensitively and a wrapper key (e.g.
    ``{"report": {...}}`` or ``{"data": {...}}``) is unwrapped.
    """
    if not isinstance(raw, dict) or not raw:
        return None
    data = raw
    # Unwrap common wrapper keys the model may have added.
    for wrapper in ("report", "result", "data", "analysis", "quality"):
        if isinstance(data.get(wrapper), dict) and len(data) == 1:
            data = data[wrapper]
            break
    if not isinstance(data, dict):
        return None

    score = _as_score(_lookup(data, "score", "rating", "overall_score", "total_score"))
    summary = str(_lookup(data, "summary", "overview", "description", "comment") or "").strip()
    strengths = _as_str_list(
        _lookup(data, "strengths", "strong_points", "strongpoints", "positives"), 6
    )
    improvements = _as_str_list(
        _lookup(data, "improvements", "improvement", "weaknesses", "areas_to_improve", "recommendations"), 6
    )
    skills = _as_str_list(_lookup(data, "skills", "skill_set", "keywords", "technologies"), 20)
    ats_keywords = _as_str_list(
        _lookup(data, "ats_keywords", "atsKeywords", "missing_keywords", "ats", "recommended_keywords"), 12
    )

    # A report with none of the expected fields is not usable - the caller
    # treats that as an unreadable/failed attempt.
    if not summary and not strengths and not improvements and not skills \
            and not ats_keywords and score == 0:
        return None

    return {
        "score": score,
        "summary": summary,
        "strengths": strengths,
        "improvements": improvements,
        "skills": skills,
        "ats_keywords": ats_keywords,
    }


def normalize_matches(raw) -> list[dict]:
    """Normalize a drive-match response into a list of
    ``{"drive_id", "score", "reason"}`` dicts. Never raises - unusable
    responses come back as an empty list."""
    if not isinstance(raw, dict):
        return []
    entries = _lookup(raw, "matches", "results", "items", "drives")
    if not isinstance(entries, list):
        return []
    out: list[dict] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        try:
            drive_id = int(entry.get("drive_id", entry.get("id")))
        except (TypeError, ValueError):
            continue
        out.append({
            "drive_id": drive_id,
            "score": _as_score(_lookup(entry, "score", "match_score", "percentage")),
            "reason": str(_lookup(entry, "reason", "explanation", "why") or "").strip()[:300],
        })
    return out
