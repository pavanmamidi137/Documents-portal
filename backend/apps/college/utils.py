"""Date-based helpers for the college reference data."""

import re
from datetime import date as date_type

from .models import Semester

# Matches the "X-Y" semester naming convention used across the portal
# (e.g. "4-1", "1-2"). The year digit is the "X" and the half is the "Y".
_YEAR_HALF_RE = re.compile(r"^(\d+)\s*[-/]\s*(\d+)")


def _semester_key(semester: Semester):
    """(year, half) parsed from a semester name like "4-1", or None."""
    m = _YEAR_HALF_RE.match(semester.name.strip())
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2)))


def get_current_semester(today=None):
    """The semester currently running, guessed from the calendar date.

    Semesters run in two 6-month halves of the academic year:

      first half  = June - November  (e.g. "4-1") - "this semester runs
                    until the end of November"
      second half = December - May   (e.g. "4-2")

    The year digit (the "4" in "4-1") is taken from the senior-most semester
    configured - i.e. the current final-year batch - and rolls over by itself
    once the next year's semesters are added.

    Returns None when no semesters exist. When the exact semester isn't
    configured, it falls back to the closest available one so the upload and
    subject forms still get a sensible default.
    """
    today = today or date_type.today()
    # Jun-Nov -> first half (X-1), Dec-May -> second half (X-2).
    half = 1 if 6 <= today.month <= 11 else 2

    pairs = [(s, _semester_key(s)) for s in Semester.objects.all()]
    parsed = [p for p in pairs if p[1] is not None]
    if not parsed:
        return Semester.objects.order_by("order", "name").first()

    max_year = max(p[1][0] for p in parsed)
    target = (max_year, half)
    ordered = sorted(parsed, key=lambda p: p[1])
    for semester, key in ordered:
        if key == target:
            return semester
    # No exact match - closest semester below the target, else the senior-most.
    candidates = [s for s, key in ordered if key < target]
    return candidates[-1] if candidates else ordered[-1][0]
