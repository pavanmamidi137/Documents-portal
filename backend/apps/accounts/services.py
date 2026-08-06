"""Service layer for student account management.

Keeps business rules (section scoping, role transitions, audit logging)
out of the view layer and reusable across the API and management commands.
"""
import csv
import io

from django.contrib.auth.hashers import make_password
from django.db import IntegrityError, transaction

from apps.core.utils import log_audit

from .models import User

CSV_REQUIRED_COLUMNS = {"roll number", "student name"}


@transaction.atomic
def create_student(data: dict, actor: User, request=None) -> User:
    """Create a student account with audit logging.

    Roll numbers are stored in UPPERCASE and the default password is the
    student's own roll number (they can change it after first login).
    """
    data.setdefault("role", User.Role.STUDENT)
    roll_number = data.pop("roll_number").strip().upper()
    password = data.pop("password", None) or roll_number
    student = User.objects.create_user(roll_number, password, **data)
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
        rows.append({"roll": roll, "full_name": full_name, "email": email, "phone": phone, "seen": seen})

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
            # only refreshes name/email/phone.
            student.full_name = r["full_name"]
            if r["email"]:
                student.email = r["email"]
            student.phone = r["phone"]
            update_pairs.append((r, student))

        if create_rows:
            # Default password is the roll number (in capitals), hashed with the
            # lightweight ImportPBKDF2 hasher - Django upgrades it to full
            # PBKDF2 on the student's first login.
            created_users = [
                User(
                    roll_number=r["roll"], full_name=r["full_name"],
                    email=r["email"] or None, phone=r["phone"],
                    role=User.Role.STUDENT, branch=branch, section=section,
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
                            email=u.email, phone=u.phone, role=u.role,
                            branch=branch, section=section, password=u.password,
                        )
                        created += 1
                    except IntegrityError:
                        errors.append({
                            "row": r["seen"], "roll_number": r["roll"],
                            "error": "Could not create this student (duplicate email or roll number).",
                        })

        if update_pairs:
            update_rows = [s for _, s in update_pairs]
            try:
                User.objects.bulk_update(update_rows, ["full_name", "email", "phone"], batch_size=500)
                updated = len(update_pairs)
            except IntegrityError:
                # Racing insert between the email check and the write - fall back
                # to one-by-one so only the conflicting row is reported.
                updated = 0
                for r, student in update_pairs:
                    try:
                        student.save(update_fields=["full_name", "email", "phone"])
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
