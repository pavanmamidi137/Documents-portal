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
        self.branch = Branch.objects.create(name="CSE")
        self.section = Section.objects.create(branch=self.branch, name="A")

    def _csv_file(self, content: str):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return SimpleUploadedFile("students.csv", content.encode("utf-8"))

    def test_admin_import_places_all_rows_in_selected_section(self):
        csv_content = (
            "Roll Number,Student Name,Email,Phone\n"
            "21CSE01,Aarav,aarav@test.com,9999999999\n"
            "21CSE02,Bhavya,bhavya@test.com,8888888888\n"
        )
        result = services.import_students_csv(
            self._csv_file(csv_content), self.admin,
            branch_id=self.branch.id, section_id=self.section.id,
        )
        self.assertEqual(result["created"], 2)
        self.assertEqual(result["updated"], 0)
        student = User.objects.get(roll_number="21CSE01")
        self.assertEqual(student.branch, self.branch)
        self.assertEqual(student.section, self.section)
        # Default password is the uppercase roll number, stored with the fast
        # import hasher so large imports stay fast.
        self.assertTrue(student.password.startswith("pbkdf2_sha256_import$"))
        # First password check verifies AND upgrades to the strong default hasher.
        self.assertTrue(student.check_password("21CSE01"))
        self.assertTrue(student.password.startswith("pbkdf2_sha256$"))

    def test_admin_import_requires_branch(self):
        csv_content = "Roll Number,Student Name\n21CSE01,Aarav\n"
        with self.assertRaises(ValueError):
            services.import_students_csv(self._csv_file(csv_content), self.admin)

    def test_admin_import_defaults_to_first_section(self):
        csv_content = "Roll Number,Student Name\n21CSE01,Aarav\n"
        result = services.import_students_csv(
            self._csv_file(csv_content), self.admin, branch_id=self.branch.id
        )
        self.assertEqual(result["created"], 1)
        self.assertEqual(
            User.objects.get(roll_number="21CSE01").section, self.section
        )

    def test_import_updates_existing(self):
        csv_content = "Roll Number,Student Name,Email,Phone\n21CSE01,Aarav,aarav@test.com,9999999999\n"
        result = services.import_students_csv(
            self._csv_file(csv_content), self.admin,
            branch_id=self.branch.id, section_id=self.section.id,
        )
        self.assertEqual(result["created"], 1)
        # Re-import with a changed name/phone refreshes in place.
        csv_content2 = "Roll Number,Student Name,Phone\n21CSE01,Aarav R,7777777777\n"
        result2 = services.import_students_csv(
            self._csv_file(csv_content2), self.admin,
            branch_id=self.branch.id, section_id=self.section.id,
        )
        self.assertEqual(result2["updated"], 1)
        student = User.objects.get(roll_number="21CSE01")
        self.assertEqual(student.full_name, "Aarav R")
        self.assertEqual(student.phone, "7777777777")

    def test_import_rejects_missing_columns(self):
        bad = self._csv_file("Name,Email\nAarav,a@x.com\n")
        with self.assertRaises(ValueError):
            services.import_students_csv(bad, self.admin)

    def test_import_reports_duplicate_roll_numbers(self):
        csv_content = "Roll Number,Student Name\n21CSE01,Aarav\n21CSE01,Aarav Again\n"
        result = services.import_students_csv(
            self._csv_file(csv_content), self.admin,
            branch_id=self.branch.id, section_id=self.section.id,
        )
        self.assertEqual(result["created"], 1)
        self.assertEqual(len(result["skipped_errors"]), 1)
        self.assertIn("Duplicate", result["skipped_errors"][0]["error"])


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
            "Roll Number,Student Name,Email,Phone\n"
            "21CSE01,Aarav,aarav@test.com,9999999999\n"
            "21CSE02,Bhavya,bhavya@test.com,8888888888\n"
        )
        result = services.import_students_csv(self._csv_file(csv_content), self.cr)
        self.assertEqual(result["created"], 2)
        self.assertEqual(result["updated"], 0)
        a = User.objects.get(roll_number="21CSE01")
        self.assertEqual(a.branch, self.branch)
        self.assertEqual(a.section, self.section_a)
        # Default password is the uppercase roll number.
        self.assertTrue(a.check_password("21CSE01"))

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


class AdminApiCsvImportTests(TestCase):
    def setUp(self):
        self.branch = Branch.objects.create(name="IT")
        self.section_a = Section.objects.create(branch=self.branch, name="A")
        self.section_b = Section.objects.create(branch=self.branch, name="B")
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )

    def _login(self) -> APIClient:
        client = APIClient()
        login = client.post(
            "/api/auth/login/",
            {"roll_number": "admin", "password": "x"},
            format="json",
        )
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        return client

    def test_admin_imports_into_selected_branch_and_section(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        client = self._login()
        f = SimpleUploadedFile(
            "students.csv",
            "Roll Number,Student Name\n21IT01,Diya\n21IT02,Arjun\n".encode("utf-8"),
        )
        response = client.post(
            "/api/students/import_csv/",
            {"file": f, "branch": str(self.branch.id), "section": str(self.section_b.id)},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(
            User.objects.get(roll_number="21IT01").section, self.section_b
        )

    def test_admin_import_without_branch_is_rejected(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        client = self._login()
        f = SimpleUploadedFile(
            "students.csv", "Roll Number,Student Name\n21IT01,Diya\n".encode("utf-8")
        )
        response = client.post(
            "/api/students/import_csv/", {"file": f}, format="multipart"
        )
        self.assertEqual(response.status_code, 400)


class ProfileUpdateTests(TestCase):
    def setUp(self):
        self.branch = Branch.objects.create(name="IT")
        self.section = Section.objects.create(branch=self.branch, name="A")
        self.student = User.objects.create_user(
            roll_number="21IT01", password="secret123", full_name="Diya",
            email="diya@test.com", branch=self.branch, section=self.section,
        )

    def _client(self) -> APIClient:
        client = APIClient()
        login = client.post(
            "/api/auth/login/",
            {"roll_number": "21IT01", "password": "secret123"},
            format="json",
        )
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        return client

    def test_student_updates_own_details(self):
        client = self._client()
        response = client.patch(
            "/api/auth/me/",
            {"full_name": "Diya Sharma", "phone": "9876543210", "email": ""},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.student.refresh_from_db()
        self.assertEqual(self.student.full_name, "Diya Sharma")
        self.assertEqual(self.student.phone, "9876543210")
        self.assertIsNone(self.student.email)

    def test_email_must_be_unique(self):
        User.objects.create_user(
            roll_number="21IT02", password="x", full_name="Arjun",
            email="taken@test.com", branch=self.branch, section=self.section,
        )
        client = self._client()
        response = client.patch(
            "/api/auth/me/", {"email": "taken@test.com"}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_identity_fields_cannot_be_changed_via_me(self):
        client = self._client()
        response = client.patch(
            "/api/auth/me/",
            {"roll_number": "HACKED", "branch": 999, "role": "SUPER_ADMIN"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.student.refresh_from_db()
        self.assertEqual(self.student.roll_number, "21IT01")
        self.assertEqual(self.student.role, "STUDENT")


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
