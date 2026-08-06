"""Service layer for student account management.

Keeps business rules (section scoping, role transitions, audit logging)
out of the view layer and reusable across the API and management commands.
"""
import csv
import io

from django.db import transaction
from django.utils.text import capfirst

from apps.core.utils import log_audit

from .models import User

CSV_REQUIRED_COLUMNS = {"roll number", "student name"}


def get_or_create_branch_section(branch_name: str, section_name: str):
    """Resolve (or create when missing) a branch and section by name."""
    from apps.college.models import Branch, Section

    branch, _ = Branch.objects.get_or_create(name=capfirst(branch_name.strip()))
    section, _ = Section.objects.get_or_create(branch=branch, name=capfirst(section_name.strip()))
    return branch, section


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


def import_students_csv(file, actor: User, request=None) -> dict:
    """Import students from an uploaded CSV.

    Expected columns: roll_number, full_name, email, phone, branch, section, password
    (headers are matched case-insensitively; spaces/underscores tolerated).
    Existing roll numbers are updated in place.

    Roll numbers are normalized to UPPERCASE. When no password is supplied the
    default password is the student's roll number (in capitals).

    CR imports are confined to the actor's own branch/section: Branch/Section
    columns are ignored, and roll numbers belonging to a different section are
    skipped rather than overwritten.
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

    # CRs may only import into their own assigned section.
    scoped_section = None
    if actor.is_cr:
        if not (actor.branch_id and actor.section_id):
            raise ValueError(
                "Your account is not assigned a branch/section yet. "
                "Ask a Super Admin to assign one before importing students."
            )
        scoped_section = actor.section

    created = updated = 0
    errors: list[dict] = []
    seen = 0

    with transaction.atomic():
        for row in reader:
            seen += 1
            roll = (row.get(col["roll number"]) or "").strip().upper()
            full_name = (row.get(col["student name"]) or "").strip()
            if not roll or not full_name:
                errors.append({"row": seen, "error": "Missing roll number or student name."})
                continue
            email = (row.get(header_map.get("email")) or "").strip() if header_map.get("email") else ""
            phone = (row.get(header_map.get("phone")) or "").strip() if header_map.get("phone") else ""
            # Optional password column; defaults to the roll number (uppercase).
            raw_password = (row.get(header_map.get("password")) or "").strip() if header_map.get("password") else ""
            password = raw_password or roll
            branch_name = (row.get(header_map.get("branch")) or "").strip() if header_map.get("branch") else ""
            section_name = (row.get(header_map.get("section")) or "").strip() if header_map.get("section") else ""

            if scoped_section is not None:
                branch, section = scoped_section.branch, scoped_section
            else:
                branch = section = None
                if branch_name:
                    try:
                        branch, section = get_or_create_branch_section(branch_name, section_name or "A")
                    except Exception as exc:  # pragma: no cover
                        errors.append({"row": seen, "roll_number": roll, "error": str(exc)})
                        continue

            try:
                student, was_created = User.objects.get_or_create(
                    roll_number=roll,
                    defaults={
                        "full_name": full_name, "email": email or None, "phone": phone,
                        "role": User.Role.STUDENT, "branch": branch, "section": section,
                    },
                )
                if not was_created:
                    # A CR may only update students already in their own section.
                    if scoped_section is not None and student.section_id != scoped_section.id:
                        errors.append({
                            "row": seen, "roll_number": roll,
                            "error": "Roll number belongs to another section (or has no section assigned).",
                        })
                        continue
                    student.full_name = full_name
                    if email:
                        student.email = email
                    student.phone = phone
                    if branch:
                        student.branch = branch
                        student.section = section
                    student.save()
                # Apply the CSV password only for new accounts (or when the
                # CSV row explicitly carries a custom password).
                if was_created or raw_password:
                    student.set_password(password)
                    student.save(update_fields=["password"])
                if was_created:
                    created += 1
                else:
                    updated += 1
            except Exception as exc:
                errors.append({"row": seen, "roll_number": roll, "error": str(exc)})

    log_audit(actor, "CSV_IMPORT", "Student", "",
              {"created": created, "updated": updated, "errors": len(errors)}, request)
    return {"created": created, "updated": updated, "skipped_errors": errors}
