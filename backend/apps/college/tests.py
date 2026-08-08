from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.accounts.models import User

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
