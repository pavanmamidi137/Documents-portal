"""Seed the portal with the initial Super Admin, semesters, and categories.

Usage:
    python manage.py seed_data
"""
import os

from django.core.management.base import BaseCommand

from apps.college.models import Category, Semester

DEFAULT_SEMESTERS = ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2", "4-1", "4-2"]
DEFAULT_CATEGORIES = [
    "Mid-1", "Mid-2", "Assignments", "Notes", "Lab Manuals",
    "Lab Records", "Previous Papers", "Question Bank", "Syllabus",
]
DEFAULT_SUBJECTS = [
    "Operating Systems", "DBMS", "Java", "Python", "Computer Networks", "AI", "Mathematics",
]


class Command(BaseCommand):
    help = "Create the Super Admin account, default semesters and categories."

    def handle(self, *args, **options):
        from apps.accounts.models import User

        created_sems = self._seed_semesters()
        created_cats = self._seed_categories()
        created_subs = self._seed_subjects()
        admin = self._seed_admin()

        self.stdout.write(self.style.SUCCESS("Seed complete:"))
        self.stdout.write(f"  semesters: {created_sems} created")
        self.stdout.write(f"  categories: {created_cats} created")
        self.stdout.write(f"  sample subjects (sem 1-1): {created_subs} created")
        self.stdout.write(
            f"  super admin: {admin.roll_number} / {os.getenv('ADMIN_PASSWORD', 'Admin@123')}"
        )

    def _seed_semesters(self) -> int:
        count = 0
        for order, name in enumerate(DEFAULT_SEMESTERS, start=1):
            _, created = Semester.objects.get_or_create(name=name, defaults={"order": order})
            count += created
        return count

    def _seed_categories(self) -> int:
        count = 0
        for name in DEFAULT_CATEGORIES:
            _, created = Category.objects.get_or_create(name=name)
            count += created
        return count

    def _seed_subjects(self) -> int:
        from apps.college.models import Subject

        semester = Semester.objects.filter(name="1-1").first()
        if not semester:
            return 0
        count = 0
        for name in DEFAULT_SUBJECTS:
            _, created = Subject.objects.get_or_create(
                name=name, semester=semester, branch=None
            )
            count += created
        return count

    def _seed_admin(self):
        from apps.accounts.models import User

        roll_number = os.getenv("ADMIN_ROLL_NUMBER", "admin").strip()
        full_name = os.getenv("ADMIN_NAME", "Super Admin").strip()
        email = os.getenv("ADMIN_EMAIL", "admin@college.edu").strip() or None
        password = os.getenv("ADMIN_PASSWORD", "Admin@123")

        admin = User.objects.filter(roll_number=roll_number).first()
        if admin:
            if not admin.is_super_admin:
                admin.role = User.Role.SUPER_ADMIN
                admin.save(update_fields=["role"])
            return admin

        return User.objects.create_superuser(
            roll_number=roll_number,
            password=password,
            full_name=full_name,
            email=email,
        )
