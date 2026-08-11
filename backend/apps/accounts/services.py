"""Service layer for student account management.

Keeps business rules (section scoping, role transitions, audit logging)
out of the view layer and reusable across the API and management commands.
"""
import csv
import io

from django.contrib.auth.hashers import make_password
from django.db import IntegrityError, close_old_connections, transaction
from rest_framework.exceptions import ValidationError

from apps.core.utils import log_audit

from .models import Resume, User, derive_passout_year

CSV_REQUIRED_COLUMNS = {"roll number", "student name"}
# Optional header aliases for the batch pass-out year column.
PASSOUT_ALIASES = {
    "passout year", "passout", "passoutyear", "batch", "year of passout",
}
# Optional header aliases for the gender column.
GENDER_ALIASES = {"gender", "sex"}


def _normalize_gender(raw: str):
    """Map a CSV/typed gender value to the stored choice (case-insensitive)."""
    value = (raw or "").strip().lower()
    if value in ("m", "male", "boy", "1"):
        return User.Gender.MALE
    if value in ("f", "female", "girl", "2"):
        return User.Gender.FEMALE
    if value in ("o", "other", "3"):
        return User.Gender.OTHER
    return ""


@transaction.atomic
def create_student(data: dict, actor: User, request=None) -> User:
    """Create a student account with audit logging.

    Roll numbers are stored in UPPERCASE and the default password is the
    student's own roll number (they can change it after first login).
    """
    data.setdefault("role", User.Role.STUDENT)
    roll_number = data.pop("roll_number").strip().upper()
    password = data.pop("password", None) or roll_number
    # Default pass-out year comes from the roll number when not provided.
    passout_year = data.pop("passout_year", None) or derive_passout_year(roll_number)
    student = User.objects.create_user(
        roll_number, password, passout_year=passout_year, **data
    )
    log_audit(
        actor, "CREATE", "Student", student.id,
        {"roll_number": student.roll_number, "branch": student.branch_id, "section": student.section_id},
        request,
    )
    return student


@transaction.atomic
def update_student(student: User, data: dict, actor: User, request=None) -> User:
    for field, value in data.items():
        setattr(student, field, value)
    student.save()
    log_audit(actor, "UPDATE", "Student", student.id,
              {"roll_number": student.roll_number}, request)
    return student


@transaction.atomic
def delete_student(student: User, actor: User, request=None) -> None:
    roll = student.roll_number
    # Remove the student's resume file from Cloudinary before the row cascades.
    resume = getattr(student, "resume", None)
    if resume and resume.public_id:
        from apps.documents.services import delete_document_file

        delete_document_file(resume.public_id)
    student.delete()
    log_audit(actor, "DELETE", "Student", roll, {"roll_number": roll}, request)


@transaction.atomic
def promote_to_cr(student: User, actor: User, request=None) -> None:
    if not (student.branch_id and student.section_id):
        raise ValueError("Assign a branch and section before promoting to CR.")
    if student.is_super_admin:
        raise ValueError("Cannot promote a Super Admin.")
    student.role = User.Role.CR
    student.save()
    log_audit(actor, "PROMOTE", "Student", student.id,
              {"roll_number": student.roll_number}, request)


@transaction.atomic
def demote_to_student(student: User, actor: User, request=None) -> None:
    if student.is_super_admin:
        raise ValueError("Cannot demote a Super Admin.")
    student.role = User.Role.STUDENT
    student.save()
    log_audit(actor, "DEMOTE", "Student", student.id,
              {"roll_number": student.roll_number}, request)


@transaction.atomic
def promote_to_admin(target: User, actor: User, request=None) -> None:
    """Promote an EXISTING student/CR/faculty account to Super Admin.

    Unlike creating a brand-new admin, the account keeps its roll number and
    password (the person logs in with exactly what they used before - nothing
    to hand over). Staff flags are set so the account gets Django admin
    access too, and the promoted user is notified inside the portal.
    """
    if target.is_super_admin:
        raise ValueError("This user is already an admin.")
    if not target.is_active:
        raise ValueError("Cannot promote a deactivated account. Activate it first.")
    target.role = User.Role.SUPER_ADMIN
    target.is_staff = True
    target.is_superuser = True
    target.save(update_fields=["role", "is_staff", "is_superuser"])
    from apps.core.models import Notification
    from apps.core.utils import notify

    try:
        notify(
            User.objects.filter(pk=target.pk),
            Notification.Kind.ANNOUNCEMENT,
            "You now have admin access",
            f"{actor.full_name} promoted you to Super Admin. You can manage the whole portal.",
            "/admin",
        )
    except Exception:
        pass  # a failed notification must never roll back the promotion
    log_audit(actor, "ADMIN_PROMOTE", "Admin", target.id,
              {"roll_number": target.roll_number, "promoted_by": actor.roll_number}, request)


@transaction.atomic
def set_active(student: User, active: bool, actor: User, request=None) -> None:
    if student.is_super_admin:
        raise ValueError("Cannot deactivate a Super Admin.")
    student.is_active = active
    student.save(update_fields=["is_active"])
    log_audit(actor, "ACTIVATE" if active else "DEACTIVATE", "Student", student.id,
              {"roll_number": student.roll_number}, request)


@transaction.atomic
def reset_password(student: User, new_password: str, actor: User, request=None) -> None:
    student.set_password(new_password)
    student.save(update_fields=["password"])
    log_audit(actor, "PASSWORD_RESET", "Student", student.id,
              {"roll_number": student.roll_number}, request)


def import_students_csv(file, actor: User, request=None, branch_id=None, section_id=None) -> dict:
    """Import students from an uploaded CSV.

    Expected columns: Roll Number, Student Name, Phone, Email (only the roll
    number and name are required; headers are matched case-insensitively and
    spaces/underscores tolerated). Existing roll numbers are updated in place.

    Roll numbers are normalized to UPPERCASE and every new account's default
    password is its own roll number (in capitals).

    Placement is decided up front, not per row:
      * CRs import only into their own assigned branch/section.
      * Super Admins pass a target ``branch_id``/``section_id`` for the whole
        file, so the CSV itself carries no branch/section/password columns.
    """
    content = file.read().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    if not reader.fieldnames:
        raise ValueError("CSV file is empty or has no header row.")

    def norm(value: str) -> str:
        return (value or "").strip().lower().replace("_", " ").replace("-", " ")

    header_map = {norm(h): h for h in reader.fieldnames if h}
    col = {key: header_map[key] for key in CSV_REQUIRED_COLUMNS if key in header_map}
    if len(col) < 2:
        raise ValueError("CSV must contain 'Roll Number' and 'Student Name' columns.")
    # Optional "Passout Year" / "Batch" column (any alias).
    passout_col = next(
        (header_map[k] for k in PASSOUT_ALIASES if k in header_map), None
    )
    # Optional "Gender" column (any alias).
    gender_col = next(
        (header_map[k] for k in GENDER_ALIASES if k in header_map), None
    )

    # Resolve the single target branch/section for the whole file.
    if actor.is_cr:
        if not (actor.branch_id and actor.section_id):
            raise ValueError(
                "Your account is not assigned a branch/section yet. "
                "Ask a Super Admin to assign one before importing students."
            )
        branch, section = actor.branch, actor.section
    else:
        from apps.college.models import Branch, Section

        if not branch_id:
            raise ValueError("Select a branch and section for the import.")
        branch = Branch.objects.filter(pk=branch_id).first()
        if not branch:
            raise ValueError("Selected branch does not exist.")
        if section_id:
            section = Section.objects.filter(pk=section_id, branch=branch).first()
            if not section:
                raise ValueError("Selected section does not exist.")
        else:
            # Fall back to the branch's first section (or create one).
            section = branch.sections.order_by("name").first()
            if not section:
                section = Section.objects.create(branch=branch, name="A")

    scoped_section = section if actor.is_cr else None
    errors: list[dict] = []
    rows: list[dict] = []

    # Parse the file first (cheap), then do ONE batch of database work.
    for seen, row in enumerate(reader, start=1):
        roll = (row.get(col["roll number"]) or "").strip().upper()
        full_name = (row.get(col["student name"]) or "").strip()
        if not roll or not full_name:
            errors.append({"row": seen, "error": "Missing roll number or student name."})
            continue
        # Emails are normalized to lowercase for consistency with the
        # profile-update path (avoids case-duplicate accounts).
        email = ((row.get(header_map.get("email")) or "").strip().lower()
                 if header_map.get("email") else "")
        phone = (row.get(header_map.get("phone")) or "").strip() if header_map.get("phone") else ""
        gender = (
            _normalize_gender(row.get(gender_col))
            if gender_col else ""
        )
        passout_year = None
        if passout_col:
            raw = (row.get(passout_col) or "").strip()
            if raw.isdigit() and 1990 <= int(raw) <= 2100:
                passout_year = int(raw)
        if passout_year is None:
            passout_year = derive_passout_year(roll)
        rows.append({
            "roll": roll, "full_name": full_name, "email": email,
            "phone": phone, "gender": gender,
            "passout_year": passout_year, "seen": seen,
        })

    if not rows:
        return {"created": 0, "updated": 0, "skipped_errors": errors}

    created = updated = 0
    rolls = [r["roll"] for r in rows]

    with transaction.atomic():
        # Load every existing roll number with a single query instead of one
        # get_or_create round-trip per row.
        existing = {
            u.roll_number: u
            for u in User.objects.filter(roll_number__in=rolls)
        }
        # Emails already owned by accounts OUTSIDE this file (protects the bulk
        # writes below from unique-constraint failures).
        taken_emails = set(
            User.objects.exclude(roll_number__in=rolls)
            .filter(email__in=[r["email"] for r in rows if r["email"]])
            .values_list("email", flat=True)
        )
        # Emails already held by students in this file (same roll can keep its
        # own email; a different roll may not take it).
        email_to_roll = {
            u.email.lower(): u.roll_number
            for u in existing.values() if u.email
        }

        create_rows: list[dict] = []
        update_pairs: list[tuple[dict, User]] = []
        seen_rolls: set[str] = set()

        def claim_email(r: dict) -> bool:
            """Check and reserve a row's email; records an error when taken."""
            if not r["email"]:
                return True
            lower_email = r["email"].lower()
            owner = email_to_roll.get(lower_email)
            if (owner is not None and owner != r["roll"]) or lower_email in taken_emails:
                errors.append({
                    "row": r["seen"], "roll_number": r["roll"],
                    "error": "This email is already in use by another student.",
                })
                return False
            email_to_roll[lower_email] = r["roll"]
            return True

        for r in rows:
            if r["roll"] in seen_rolls:
                errors.append({
                    "row": r["seen"], "roll_number": r["roll"],
                    "error": "Duplicate roll number in the CSV file.",
                })
                continue
            seen_rolls.add(r["roll"])

            student = existing.get(r["roll"])
            if student is None:
                if claim_email(r):
                    create_rows.append(r)
                continue

            # A CR may only update students already in their own section.
            if scoped_section is not None and student.section_id != scoped_section.id:
                errors.append({
                    "row": r["seen"], "roll_number": r["roll"],
                    "error": "Roll number belongs to another section (or has no section assigned).",
                })
                continue
            if not claim_email(r):
                continue
            # Placement (branch/section) is fixed at creation time - a re-import
            # only refreshes name/email/phone/gender (and batch when the column
            # exists). A blank gender cell never wipes an existing value.
            student.full_name = r["full_name"]
            if r["email"]:
                student.email = r["email"]
            student.phone = r["phone"]
            if gender_col and r["gender"]:
                student.gender = r["gender"]
            if passout_col:
                student.passout_year = r["passout_year"]
            update_pairs.append((r, student))

        if create_rows:
            # Default password is the roll number (in capitals), hashed with the
            # lightweight ImportPBKDF2 hasher - Django upgrades it to full
            # PBKDF2 on the student's first login.
            created_users = [
                User(
                    roll_number=r["roll"], full_name=r["full_name"],
                    email=r["email"] or None, phone=r["phone"], gender=r["gender"],
                    role=User.Role.STUDENT, branch=branch, section=section,
                    passout_year=r["passout_year"],
                    password=make_password(r["roll"], hasher="pbkdf2_sha256_import"),
                )
                for r in create_rows
            ]
            try:
                User.objects.bulk_create(created_users, batch_size=500)
                created = len(create_rows)
            except IntegrityError:
                # A racing insert (e.g. an email created between the check and
                # the write) - fall back to one-by-one so only the conflicting
                # row is reported and skipped.
                created = 0
                for r, u in zip(create_rows, created_users):
                    try:
                        User.objects.create(
                            roll_number=u.roll_number, full_name=u.full_name,
                            email=u.email, phone=u.phone, gender=u.gender,
                            role=u.role, branch=branch, section=section,
                            passout_year=u.passout_year, password=u.password,
                        )
                        created += 1
                    except IntegrityError:
                        errors.append({
                            "row": r["seen"], "roll_number": r["roll"],
                            "error": "Could not create this student (duplicate email or roll number).",
                        })

        if update_pairs:
            update_fields = ["full_name", "email", "phone"]
            if gender_col:
                update_fields.append("gender")
            if passout_col:
                update_fields.append("passout_year")
            update_rows = [s for _, s in update_pairs]
            try:
                User.objects.bulk_update(update_rows, update_fields, batch_size=500)
                updated = len(update_pairs)
            except IntegrityError:
                # Racing insert between the email check and the write - fall back
                # to one-by-one so only the conflicting row is reported.
                updated = 0
                for r, student in update_pairs:
                    try:
                        student.save(update_fields=update_fields)
                        updated += 1
                    except IntegrityError:
                        errors.append({
                            "row": r["seen"], "roll_number": r["roll"],
                            "error": "Could not update this student (email already in use).",
                        })
        else:
            updated = 0

    log_audit(actor, "CSV_IMPORT", "Student", "",
              {"created": created, "updated": updated, "errors": len(errors)}, request)
    return {"created": created, "updated": updated, "skipped_errors": errors}


# ---------------------------------------------------------------------------
# Resumes
# ---------------------------------------------------------------------------
RESUME_EXTENSIONS = {".pdf", ".doc", ".docx"}


def _effective_ai_limits(student: User) -> dict:
    """Portal defaults overridden by the student's AiAccessConfig row."""
    from django.conf import settings

    defaults = {
        "daily_ai_requests": settings.AI_DAILY_REQUEST_LIMIT,
        "ats_view_interval_days": settings.ATS_VIEW_INTERVAL_DAYS,
        "daily_resume_uploads": settings.RESUME_DAILY_UPLOAD_LIMIT,
        "unlimited_ai": False,
    }
    config = getattr(student, "ai_access", None)
    if config:
        if config.unlimited_ai:
            defaults["unlimited_ai"] = True
        if config.daily_ai_requests is not None:
            defaults["daily_ai_requests"] = config.daily_ai_requests
        if config.ats_view_interval_days is not None:
            defaults["ats_view_interval_days"] = config.ats_view_interval_days
        if config.daily_resume_uploads is not None:
            defaults["daily_resume_uploads"] = config.daily_resume_uploads
    return defaults


def _today_start():
    from django.utils import timezone

    return timezone.localdate()


def _ai_requests_used_today(student: User) -> int:
    """Count the student's AI review/ask/chat calls made today."""
    from apps.placements.models import AiUsageLog

    return AiUsageLog.objects.filter(
        user=student,
        created_at__date=_today_start(),
    ).count()


def _resume_uploads_used_today(student: User) -> int:
    """Count resume uploads/replacements the student made today (audit trail)."""
    from apps.core.models import AuditLog

    return AuditLog.objects.filter(
        actor=student,
        action__in=["RESUME_UPLOAD", "RESUME_UPDATE"],
        created_at__date=_today_start(),
    ).count()


def _resume_folder(student: User) -> str:
    """Cloudinary folder: resumes/{branch}/{section}/"""
    from apps.core.utils import slugify

    branch = slugify(student.branch.name) if student.branch else "no-branch"
    section = slugify(student.section.name) if student.section else "no-section"
    return f"resumes/{branch}/{section}"


# Resumes are compressed automatically on upload; anything still larger than
# this after compression is rejected.
RESUME_TARGET_BYTES = 500 * 1024  # 500KB


def _validate_resume_file(document_file) -> None:
    """Reject non-PDF/DOC/DOCX files and files over the input size limit.

    The input cap is generous so large files still get a chance to be
    compressed; the 500KB target is enforced after compression in
    ``upload_document``.
    """
    if not document_file:
        raise ValidationError({"file": "A resume file is required."})
    if document_file.size <= 0:
        raise ValidationError({"file": "The uploaded file is empty."})
    name = (getattr(document_file, "name", "") or "").lower()
    ext = f".{name.rpartition('.')[2]}" if "." in name else ""
    if ext not in RESUME_EXTENSIONS:
        raise ValidationError({"file": "Only PDF, DOC or DOCX resume files are allowed."})
    max_bytes = 10 * 1024 * 1024
    if document_file.size > max_bytes:
        raise ValidationError({"file": "Resume exceeds the 10MB input size limit."})


@transaction.atomic
def upload_resume(student: User, resume_file, request=None) -> Resume:
    """Upload (or replace) a student's resume on Cloudinary.

    One resume per student: an existing Cloudinary file is removed first, then
    the new file is uploaded and the Resume row is updated in place. Enforces
    the student's per-day resume upload limit and kicks off an automatic AI
    analysis right after the upload so the review is ready immediately.
    """
    from django.conf import settings

    from apps.documents.services import delete_document_file, upload_document

    _validate_resume_file(resume_file)
    # Per-day upload limit (default 2, admin-adjustable per student).
    limit = _effective_ai_limits(student)["daily_resume_uploads"]
    if limit and _resume_uploads_used_today(student) >= limit:
        raise ValidationError({
            "detail": (
                f"You can upload a resume only {limit} time(s) per day. "
                "Try again tomorrow, or ask the admin for a higher limit."
            )
        })
    folder = _resume_folder(student)
    # PDFs/DOCX over 2MB are compressed automatically; after compression the
    # resume must fit within the 500KB target.
    uploaded = upload_document(resume_file, folder, target_bytes=RESUME_TARGET_BYTES)

    resume, created = Resume.objects.get_or_create(student=student)
    if not created and resume.public_id and resume.public_id != uploaded["public_id"]:
        delete_document_file(resume.public_id)
    resume.file_name = uploaded["file_name"]
    resume.file_size = uploaded["file_size"]
    resume.cloudinary_url = uploaded["url"]
    resume.public_id = uploaded["public_id"]
    if not created:
        # A new file is a fresh submission - clear any previous review status
        # and any "file missing" flag from a deleted Cloudinary file.
        resume.is_reviewed = False
        resume.reviewed_by = None
        resume.reviewed_at = None
        # The old file's AI analysis (quality + drive matches) no longer
        # applies to the new version - reset it so it gets re-run on demand.
        resume.ai_status = Resume.AiStatus.PENDING
        resume.ai_score = None
        resume.ai_analysis = None
        resume.ai_match = None
        resume.ai_error = ""
        resume.ai_analyzed_at = None
    resume.is_missing = False
    resume.file_checked_at = None
    # A fresh submission is not a "restored" file - clear any previous badge.
    resume.restored_at = None
    resume.save()
    # Faculty of the student's branch hear about a NEW resume (a replacement is
    # just an edit - no need to re-ring the bell).
    if created and student.branch_id:
        from apps.core.models import Notification
        from apps.core.utils import notify

        faculty = User.objects.filter(
            role=User.Role.FACULTY, branch_id=student.branch_id, is_active=True
        )
        notify(
            faculty,
            Notification.Kind.RESUME_UPLOAD,
            f"{student.full_name} uploaded a resume",
            f"A resume from {student.branch.name} is ready for review.",
            "/faculty/resumes",
        )
    log_audit(
        student, "RESUME_UPLOAD" if created else "RESUME_UPDATE", "Resume", resume.id,
        {"roll_number": student.roll_number, "file": resume.file_name},
        request,
    )
    # Auto-analyse the new file in the background so the star rating and drive
    # matches are ready when the student opens their resume page. Best-effort:
    # if the AI is unavailable or the student hit their daily AI request limit
    # the resume stays PENDING and they can run it manually later. Gated by
    # AI_AUTO_ANALYZE_ON_UPLOAD (tests disable it for speed/hermeticity).
    if getattr(settings, "AI_AUTO_ANALYZE_ON_UPLOAD", True):
        try:
            import threading

            threading.Thread(
                target=_auto_analyze_in_thread, args=(resume.id,), daemon=True
            ).start()
        except Exception:
            pass  # never fail an upload because the background thread failed
    return resume


def _auto_analyze_in_thread(resume_id: int):
    """Run the AI resume review right after an upload (in a background thread)."""
    # This thread outlives the request, so it needs its own DB connections:
    # Django closes the request's connection when the response finishes.
    close_old_connections()
    try:
        from apps.placements.resume_ai import analyze_resume

        resume = Resume.objects.select_related("student").filter(pk=resume_id).first()
        if not resume or resume.is_missing:
            return
        limits = _effective_ai_limits(resume.student)
        if not limits["unlimited_ai"] and \
                _ai_requests_used_today(resume.student) >= limits["daily_ai_requests"]:
            return  # the student already used today's AI quota - leave it PENDING
        analyze_resume(resume, resume.student)
    except Exception:
        pass  # background analysis must never crash anything
    finally:
        close_old_connections()


@transaction.atomic
def delete_resume(resume: Resume, actor: User, request=None) -> None:
    """Delete a resume row and its Cloudinary file."""
    from apps.documents.services import delete_document_file

    roll = resume.student.roll_number
    if resume.public_id:
        delete_document_file(resume.public_id)
    resume.delete()
    log_audit(actor, "RESUME_DELETE", "Resume", roll,
              {"roll_number": roll, "file": resume.file_name}, request)
