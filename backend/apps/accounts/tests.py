import io

from django.test import TestCase
from rest_framework.test import APIClient

from apps.college.models import Branch, Section

from .models import User
from . import services


class UserModelTests(TestCase):
    def setUp(self):
        self.branch = Branch.objects.create(name="CSE")
        self.section = Section.objects.create(branch=self.branch, name="A")

    def test_create_student_with_roll_number(self):
        student = User.objects.create_user(
            roll_number="21CSE01", password="secret123", full_name="Aarav",
            branch=self.branch, section=self.section,
        )
        self.assertEqual(student.roll_number, "21CSE01")
        self.assertTrue(student.check_password("secret123"))
        self.assertTrue(student.is_student)
        self.assertFalse(student.is_cr)
        self.assertFalse(student.is_super_admin)

    def test_promote_and_demote(self):
        admin = User.objects.create_superuser(roll_number="admin", password="x", full_name="Admin")
        student = User.objects.create_user(
            roll_number="21CSE02", password="x", full_name="Bhavya",
            branch=self.branch, section=self.section,
        )
        services.promote_to_cr(student, admin)
        self.assertTrue(student.is_cr)
        services.demote_to_student(student, admin)
        self.assertTrue(student.is_student)

    def test_can_manage_section_scope(self):
        admin = User.objects.create_superuser(roll_number="admin", password="x", full_name="Admin")
        other_section = Section.objects.create(branch=self.branch, name="B")
        cr = User.objects.create_user(
            roll_number="21CSE03", password="x", full_name="Charan",
            branch=self.branch, section=self.section, role=User.Role.CR,
        )
        self.assertTrue(admin.can_manage_section(self.section))
        self.assertTrue(cr.can_manage_section(self.section))
        self.assertFalse(cr.can_manage_section(other_section))


class CsvImportTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(roll_number="admin", password="x", full_name="Admin")

    def _csv_file(self, content: str):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return SimpleUploadedFile("students.csv", content.encode("utf-8"))

    def test_import_creates_students_and_sections(self):
        csv_content = (
            "Roll Number,Student Name,Email,Phone,Branch,Section,Password\n"
            "21CSE01,Aarav,aarav@test.com,9999999999,CSE,A,pass123\n"
            "21CSE02,Bhavya,bhavya@test.com,8888888888,CSE,A,pass456\n"
        )
        result = services.import_students_csv(self._csv_file(csv_content), self.admin)
        self.assertEqual(result["created"], 2)
        self.assertEqual(result["updated"], 0)
        self.assertEqual(Branch.objects.filter(name="CSE").count(), 1)
        self.assertEqual(Section.objects.filter(name="A").count(), 1)
        student = User.objects.get(roll_number="21CSE01")
        self.assertTrue(student.check_password("pass123"))
        self.assertEqual(student.branch.name, "CSE")

    def test_import_updates_existing(self):
        csv_content = (
            "Roll Number,Student Name,Branch,Section\n"
            "21CSE01,Aarav,CSE,A\n"
        )
        result = services.import_students_csv(self._csv_file(csv_content), self.admin)
        self.assertEqual(result["created"], 1)
        # re-import with a changed name
        csv_content2 = "Roll Number,Student Name,Branch,Section\n21CSE01,Aarav R,CSE,A\n"
        result2 = services.import_students_csv(self._csv_file(csv_content2), self.admin)
        self.assertEqual(result2["updated"], 1)
        self.assertEqual(User.objects.get(roll_number="21CSE01").full_name, "Aarav R")

    def test_import_rejects_missing_columns(self):
        bad = self._csv_file("Name,Email\nAarav,a@x.com\n")
        with self.assertRaises(ValueError):
            services.import_students_csv(bad, self.admin)


class CsvImportForCrTests(TestCase):
    def setUp(self):
        self.branch = Branch.objects.create(name="CSE")
        self.section_a = Section.objects.create(branch=self.branch, name="A")
        self.section_b = Section.objects.create(branch=self.branch, name="B")
        self.cr = User.objects.create_user(
            roll_number="CR01", password="x", full_name="CR",
            branch=self.branch, section=self.section_a, role=User.Role.CR,
        )

    def _csv_file(self, content: str):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return SimpleUploadedFile("students.csv", content.encode("utf-8"))

    def test_cr_import_places_students_in_own_section(self):
        """Branch/Section columns in the CSV are ignored for CRs."""
        csv_content = (
            "Roll Number,Student Name,Email,Phone,Branch,Section,Password\n"
            "21CSE01,Aarav,aarav@test.com,9999999999,IT,B,pass123\n"
            "21CSE02,Bhavya,bhavya@test.com,8888888888,IT,B,pass456\n"
        )
        result = services.import_students_csv(self._csv_file(csv_content), self.cr)
        self.assertEqual(result["created"], 2)
        self.assertEqual(result["updated"], 0)
        a = User.objects.get(roll_number="21CSE01")
        self.assertEqual(a.branch, self.branch)
        self.assertEqual(a.section, self.section_a)
        self.assertTrue(a.check_password("pass123"))

    def test_cr_import_skips_roll_numbers_from_other_sections(self):
        existing = User.objects.create_user(
            roll_number="21IT01", password="x", full_name="Diya",
            branch=self.branch, section=self.section_b,
        )
        csv_content = "Roll Number,Student Name\n21IT01,Diya\n21CSE02,Bhavya\n"
        result = services.import_students_csv(self._csv_file(csv_content), self.cr)
        self.assertEqual(result["created"], 1)
        self.assertEqual(len(result["skipped_errors"]), 1)
        existing.refresh_from_db()
        self.assertEqual(existing.section, self.section_b)  # untouched

    def test_cr_import_updates_students_in_own_section(self):
        own = User.objects.create_user(
            roll_number="21CSE01", password="x", full_name="Old",
            branch=self.branch, section=self.section_a,
        )
        csv_content = "Roll Number,Student Name\n21CSE01,Aarav\n"
        result = services.import_students_csv(self._csv_file(csv_content), self.cr)
        self.assertEqual(result["updated"], 1)
        own.refresh_from_db()
        self.assertEqual(own.full_name, "Aarav")

    def test_cr_without_section_raises(self):
        cr_no_section = User.objects.create_user(
            roll_number="CR02", password="x", full_name="CR2", role=User.Role.CR,
        )
        csv_content = "Roll Number,Student Name\n21CSE01,Aarav\n"
        with self.assertRaises(ValueError):
            services.import_students_csv(self._csv_file(csv_content), cr_no_section)

    def test_cr_can_import_via_api(self):
        client = APIClient()
        login = client.post(
            "/api/auth/login/",
            {"roll_number": "CR01", "password": "x"},
            format="json",
        )
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        f = self._csv_file("Roll Number,Student Name\n21CSE01,Aarav\n")
        response = client.post("/api/students/import_csv/", {"file": f}, format="multipart")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(
            User.objects.get(roll_number="21CSE01").section, self.section_a
        )

    def test_student_cannot_import_via_api(self):
        student = User.objects.create_user(
            roll_number="21CSE99", password="x", full_name="Student",
            branch=self.branch, section=self.section_a,
        )
        client = APIClient()
        login = client.post(
            "/api/auth/login/",
            {"roll_number": "21CSE99", "password": "x"},
            format="json",
        )
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        f = self._csv_file("Roll Number,Student Name\n21CSE01,Aarav\n")
        response = client.post("/api/students/import_csv/", {"file": f}, format="multipart")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(User.objects.filter(roll_number="21CSE01").exists())


class LoginTests(TestCase):
    def setUp(self):
        self.branch = Branch.objects.create(name="IT")
        self.section = Section.objects.create(branch=self.branch, name="A")
        self.student = User.objects.create_user(
            roll_number="21IT01", password="secret123", full_name="Diya",
            branch=self.branch, section=self.section,
        )

    def test_login_returns_tokens_and_profile(self):
        client = APIClient()
        response = client.post(
            "/api/auth/login/",
            {"roll_number": "21IT01", "password": "secret123"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)
        self.assertEqual(response.data["user"]["role"], "STUDENT")

    def test_login_wrong_password_rejected(self):
        client = APIClient()
        response = client.post(
            "/api/auth/login/",
            {"roll_number": "21IT01", "password": "wrong"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)

    def test_me_endpoint(self):
        client = APIClient()
        response = client.post(
            "/api/auth/login/",
            {"roll_number": "21IT01", "password": "secret123"},
            format="json",
        )
        token = response.data["access"]
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        me = client.get("/api/auth/me/")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data["roll_number"], "21IT01")

    def test_logout_blacklists_refresh_token(self):
        client = APIClient()
        login = client.post(
            "/api/auth/login/",
            {"roll_number": "21IT01", "password": "secret123"},
            format="json",
        )
        refresh = login.data["refresh"]
        access = login.data["access"]
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        logout = client.post("/api/auth/logout/", {"refresh": refresh}, format="json")
        self.assertEqual(logout.status_code, 204)
        # The blacklisted refresh token must no longer work.
        reused = client.post("/api/auth/refresh/", {"refresh": refresh}, format="json")
        self.assertEqual(reused.status_code, 401)
