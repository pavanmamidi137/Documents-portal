from datetime import date
from unittest import mock

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.college.utils import get_current_semester

from .models import Branch, Category, Section, Semester, Subject


class MetaQueryCountTests(TestCase):
    """The /meta/ endpoint is fetched on every page load, so it must run a
    constant number of queries regardless of how much reference data exists.
    """

    def setUp(self):
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )
        self.branch = Branch.objects.create(name="CSE")
        for s in ("A", "B", "C", "D"):
            Section.objects.create(branch=self.branch, name=s)
        self.semester = Semester.objects.create(name="1-1", order=1)
        self.category = Category.objects.create(name="Notes")
        for i in range(4):
            Subject.objects.create(
                name=f"Subject {i}", semester=self.semester, branch=self.branch
            )
        # A few students so counts are non-trivial.
        for i in range(3):
            User.objects.create_user(
                roll_number=f"21CSE0{i}",
                password="x",
                full_name=f"Student {i}",
                branch=self.branch,
                section=self.branch.sections.first(),
            )

    def _client(self) -> APIClient:
        client = APIClient()
        login = client.post(
            "/api/auth/login/",
            {"roll_number": "admin", "password": "x"},
            format="json",
        )
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        return client

    def test_meta_returns_correct_counts(self):
        client = self._client()
        response = client.get("/api/meta/")
        self.assertEqual(response.status_code, 200)
        branch = response.data["branches"][0]
        self.assertEqual(branch["sections_count"], 4)
        self.assertEqual(branch["students_count"], 3)
        section = response.data["sections"][0]
        self.assertEqual(section["students_count"], 3)
        semester = response.data["semesters"][0]
        self.assertEqual(semester["subjects_count"], 4)
        subject = response.data["subjects"][0]
        self.assertEqual(subject["documents_count"], 0)

    def test_meta_query_count_is_constant(self):
        client = self._client()
        with CaptureQueriesContext(connection) as ctx:
            client.get("/api/meta/")
        # Auth user lookup + one query per reference table (5) + session/rate
        # checks. Way below the old N+1 behaviour (~150+ COUNT queries).
        self.assertLess(len(ctx.captured_queries), 15)


class SubjectBulkImportTests(TestCase):
    """Semester-wise bulk subject import (typed names + copying existing)."""

    def setUp(self):
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )
        self.branch = Branch.objects.create(name="CSE")
        self.semester = Semester.objects.create(name="4-1", order=7)
        self.other_semester = Semester.objects.create(name="3-1", order=5)
        self.existing = Subject.objects.create(
            name="DBMS", code="CS303", semester=self.other_semester, branch=None
        )

    def _client(self) -> APIClient:
        client = APIClient()
        login = client.post(
            "/api/auth/login/",
            {"roll_number": "admin", "password": "x"},
            format="json",
        )
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        return client

    def test_bulk_import_creates_typed_subjects(self):
        client = self._client()
        response = client.post(
            "/api/subjects/bulk_import/",
            {"semester": self.semester.id, "names": ["Operating Systems", "Computer Networks"]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(
            Subject.objects.filter(semester=self.semester).count(), 2
        )

    def test_bulk_import_supports_name_and_code(self):
        client = self._client()
        response = client.post(
            "/api/subjects/bulk_import/",
            {"semester": self.semester.id, "names": ["Operating Systems, CS401", "DBMS"]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        subj = Subject.objects.get(name="Operating Systems", semester=self.semester)
        self.assertEqual(subj.code, "CS401")
        self.assertEqual(subj.branch, None)  # college-wide by default

    def test_bulk_import_to_branch(self):
        client = self._client()
        response = client.post(
            "/api/subjects/bulk_import/",
            {
                "semester": self.semester.id,
                "branch": self.branch.id,
                "names": ["ML"],
            },
            format="json",
        )
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(
            Subject.objects.get(name="ML", semester=self.semester).branch, self.branch
        )

    def test_bulk_import_skips_duplicates_case_insensitive(self):
        Subject.objects.create(name="Operating Systems", semester=self.semester)
        client = self._client()
        response = client.post(
            "/api/subjects/bulk_import/",
            {"semester": self.semester.id, "names": ["operating systems"]},
            format="json",
        )
        self.assertEqual(response.data["created"], 0)
        self.assertEqual(len(response.data["skipped"]), 1)

    def test_bulk_import_copies_existing_subjects(self):
        client = self._client()
        response = client.post(
            "/api/subjects/bulk_import/",
            {"semester": self.semester.id, "copy_ids": [self.existing.id]},
            format="json",
        )
        self.assertEqual(response.data["created"], 1)
        copied = Subject.objects.get(name="DBMS", semester=self.semester)
        self.assertEqual(copied.code, "CS303")
        self.assertEqual(
            Subject.objects.filter(name="DBMS").count(), 2  # original + copy
        )

    def test_bulk_import_requires_semester(self):
        client = self._client()
        response = client.post(
            "/api/subjects/bulk_import/",
            {"names": ["OS"]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_bulk_import_requires_input(self):
        client = self._client()
        response = client.post(
            "/api/subjects/bulk_import/",
            {"semester": self.semester.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_non_admin_cannot_bulk_import(self):
        student = User.objects.create_user(
            roll_number="21CSE01", password="x", full_name="Student"
        )
        client = APIClient()
        login = client.post(
            "/api/auth/login/",
            {"roll_number": "21CSE01", "password": "x"},
            format="json",
        )
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        response = client.post(
            "/api/subjects/bulk_import/",
            {"semester": self.semester.id, "names": ["OS"]},
            format="json",
        )
        self.assertEqual(response.status_code, 403)


class CrSubjectAccessTests(TestCase):
    """CRs create subjects for their own branch; subjects are branch-wide so
    every section of the branch sees them, and duplicates are rejected."""

    def setUp(self):
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )
        self.branch = Branch.objects.create(name="CSE", code="CSE")
        self.other_branch = Branch.objects.create(name="IT", code="IT")
        self.section = Section.objects.create(branch=self.branch, name="A")
        self.semester = Semester.objects.create(name="4-1", order=7)
        self.cr = User.objects.create_user(
            roll_number="22CSE01", password="x", full_name="CR One",
            role=User.Role.CR, branch=self.branch, section=self.section,
        )

    def _client(self, user) -> APIClient:
        client = APIClient()
        login = client.post(
            "/api/auth/login/",
            {"roll_number": user.roll_number, "password": "x"},
            format="json",
        )
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        return client

    def test_cr_creates_subject_for_own_branch(self):
        client = self._client(self.cr)
        response = client.post(
            "/api/subjects/",
            {"name": "DBMS", "semester": self.semester.id},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        subject = Subject.objects.get(name="DBMS")
        self.assertEqual(subject.branch, self.branch)

    def test_cr_cannot_force_another_branch(self):
        client = self._client(self.cr)
        response = client.post(
            "/api/subjects/",
            {
                "name": "DBMS",
                "semester": self.semester.id,
                "branch": self.other_branch.id,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        # The branch is forced back to the CR's own branch.
        self.assertEqual(Subject.objects.get(name="DBMS").branch, self.branch)

    def test_cr_cannot_create_duplicate(self):
        Subject.objects.create(name="DBMS", semester=self.semester, branch=self.branch)
        client = self._client(self.cr)
        response = client.post(
            "/api/subjects/",
            {"name": "dbms", "semester": self.semester.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(Subject.objects.filter(name__iexact="DBMS").count(), 1)

    def test_college_wide_subject_blocks_branch_duplicate(self):
        # A college-wide subject already covers every branch - a same-named
        # branch subject would be a duplicate for the branch's students.
        Subject.objects.create(name="Maths", semester=self.semester, branch=None)
        client = self._client(self.cr)
        response = client.post(
            "/api/subjects/",
            {"name": "Maths", "semester": self.semester.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)

    def test_cr_list_is_scoped_to_own_branch(self):
        own = Subject.objects.create(name="OS", semester=self.semester, branch=self.branch)
        Subject.objects.create(name="Networks", semester=self.semester, branch=self.other_branch)
        client = self._client(self.cr)
        response = client.get("/api/subjects/")
        self.assertEqual(response.status_code, 200)
        names = [s["name"] for s in response.data["results"]]
        self.assertEqual(names, ["OS"])
        self.assertNotIn("Networks", names)

    def test_cr_cannot_delete_other_branch_subject(self):
        other = Subject.objects.create(
            name="Networks", semester=self.semester, branch=self.other_branch
        )
        client = self._client(self.cr)
        response = client.delete(f"/api/subjects/{other.id}/")
        self.assertEqual(response.status_code, 404)
        self.assertTrue(Subject.objects.filter(pk=other.pk).exists())

    def test_student_cannot_create_subject(self):
        student = User.objects.create_user(
            roll_number="22CSE02", password="x", full_name="Student",
            branch=self.branch, section=self.section,
        )
        client = self._client(student)
        response = client.post(
            "/api/subjects/",
            {"name": "DBMS", "semester": self.semester.id},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_cr_without_branch_cannot_manage_subjects(self):
        """A CR with no branch assigned can neither create nor touch existing
        subjects (incl. admin-created college-wide ones)."""
        Subject.objects.create(name="Maths", semester=self.semester, branch=None)
        branchless = User.objects.create_user(
            roll_number="22CSE03", password="x", full_name="Branchless CR",
            role=User.Role.CR,
        )
        client = self._client(branchless)
        response = client.post(
            "/api/subjects/",
            {"name": "New", "semester": self.semester.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        listing = client.get("/api/subjects/")
        self.assertEqual(listing.data["results"], [])


class CurrentSemesterTests(TestCase):
    """The date-based "current semester" guess behind the auto-filled forms.

    Semesters run in two 6-month halves per year: June-November ("4-1") and
    December-May ("4-2"). The year digit comes from the senior-most batch's
    configured semesters and rolls over automatically as new ones are added.
    """

    def setUp(self):
        # The default academic set: two 6-month semesters per year.
        for order, name in enumerate(
            ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2", "4-1", "4-2"], start=1
        ):
            Semester.objects.create(name=name, order=order)

    def test_june_to_november_is_first_half(self):
        for month in (6, 7, 8, 9, 10, 11):
            sem = get_current_semester(today=date(2026, month, 15))
            self.assertEqual(sem.name, "4-1")

    def test_december_to_may_is_second_half(self):
        for month in (12, 1, 2, 3, 4, 5):
            year = 2026 if month == 12 else 2027
            sem = get_current_semester(today=date(year, month, 15))
            self.assertEqual(sem.name, "4-2")

    def test_year_digit_rolls_with_the_configured_senior_batch(self):
        # Only the first-year semesters exist -> the current one is 1-1 / 1-2.
        Semester.objects.all().delete()
        Semester.objects.create(name="1-1", order=1)
        Semester.objects.create(name="1-2", order=2)
        self.assertEqual(get_current_semester(today=date(2026, 8, 15)).name, "1-1")
        self.assertEqual(get_current_semester(today=date(2026, 12, 15)).name, "1-2")

    def test_no_semesters_returns_none(self):
        Semester.objects.all().delete()
        self.assertIsNone(get_current_semester(today=date(2026, 8, 15)))

    def test_falls_back_when_exact_semester_not_configured(self):
        Semester.objects.all().delete()
        Semester.objects.create(name="3-1", order=5)
        Semester.objects.create(name="3-2", order=6)
        # December targets 4-2; the closest configured semester is 3-2.
        self.assertEqual(get_current_semester(today=date(2026, 12, 15)).name, "3-2")

    def test_meta_endpoint_reports_current_semester(self):
        User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )
        client = APIClient()
        login = client.post(
            "/api/auth/login/",
            {"roll_number": "admin", "password": "x"},
            format="json",
        )
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        fixed = date(2026, 8, 15)

        class _FixedDate(date):
            @classmethod
            def today(cls):
                return fixed

        with mock.patch("apps.college.utils.date_type", _FixedDate):
            response = client.get("/api/meta/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["current_semester"]["name"], "4-1")
        self.assertEqual(
            response.data["current_semester"]["id"],
            Semester.objects.get(name="4-1").id,
        )
