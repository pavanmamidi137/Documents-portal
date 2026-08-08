import io
import urllib.error
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from apps.college.models import Branch, Section

from .models import Resume, User
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

    def test_derive_passout_year_from_roll_number(self):
        from .models import derive_passout_year

        self.assertEqual(derive_passout_year("21CSE01"), 2025)
        self.assertEqual(derive_passout_year("20A"), 2024)
        self.assertIsNone(derive_passout_year("CSE01"))
        self.assertIsNone(derive_passout_year(""))


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

    def test_import_honors_passout_year_column(self):
        """An explicit Passout Year column wins; blank rows are guessed."""
        csv_content = (
            "Roll Number,Student Name,Email,Phone,Passout Year\n"
            "21CSE01,Aarav,aarav@test.com,9999999999,2026\n"
            "21CSE02,Bhavya,bhavya@test.com,8888888888\n"
        )
        result = services.import_students_csv(
            self._csv_file(csv_content), self.admin,
            branch_id=self.branch.id, section_id=self.section.id,
        )
        self.assertEqual(result["created"], 2)
        self.assertEqual(User.objects.get(roll_number="21CSE01").passout_year, 2026)
        self.assertEqual(User.objects.get(roll_number="21CSE02").passout_year, 2025)

    def test_reimport_updates_passout_year(self):
        csv_content = "Roll Number,Student Name,Passout Year\n21CSE01,Aarav,2026\n"
        services.import_students_csv(
            self._csv_file(csv_content), self.admin,
            branch_id=self.branch.id, section_id=self.section.id,
        )
        csv_content2 = "Roll Number,Student Name,Passout Year\n21CSE01,Aarav R,2027\n"
        result = services.import_students_csv(
            self._csv_file(csv_content2), self.admin,
            branch_id=self.branch.id, section_id=self.section.id,
        )
        self.assertEqual(result["updated"], 1)
        self.assertEqual(User.objects.get(roll_number="21CSE01").passout_year, 2027)


class StudentApiTests(TestCase):
    """Manual student creation stores (or derives) the pass-out year."""

    def setUp(self):
        self.branch = Branch.objects.create(name="CSE")
        self.section = Section.objects.create(branch=self.branch, name="A")
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
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

    def test_create_derives_passout_year_from_roll_number(self):
        response = self._client().post(
            "/api/students/",
            {
                "roll_number": "21CSE01",
                "full_name": "Aarav",
                "branch": self.branch.id,
                "section": self.section.id,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["passout_year"], 2025)
        self.assertEqual(User.objects.get(roll_number="21CSE01").passout_year, 2025)

    def test_create_honors_explicit_passout_year(self):
        response = self._client().post(
            "/api/students/",
            {
                "roll_number": "21CSE02",
                "full_name": "Bhavya",
                "passout_year": 2027,
                "branch": self.branch.id,
                "section": self.section.id,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(User.objects.get(roll_number="21CSE02").passout_year, 2027)

    def test_update_changes_passout_year(self):
        student = User.objects.create_user(
            roll_number="21CSE03", password="x", full_name="Charan",
            branch=self.branch, section=self.section,
        )
        response = self._client().patch(
            f"/api/students/{student.id}/",
            {"passout_year": 2028},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        student.refresh_from_db()
        self.assertEqual(student.passout_year, 2028)


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


class FacultyManagementTests(TestCase):
    def setUp(self):
        self.branch = Branch.objects.create(name="IT")
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )

    def _client(self, user=None) -> APIClient:
        client = APIClient()
        target = user or self.admin
        login = client.post(
            "/api/auth/login/",
            {"roll_number": target.roll_number, "password": "x"},
            format="json",
        )
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        return client

    def test_admin_creates_faculty_with_default_password(self):
        client = self._client()
        response = client.post(
            "/api/faculty/",
            {
                "roll_number": "FAC01",
                "full_name": "Prof. Rao",
                "email": "rao@college.edu",
                "branch": str(self.branch.id),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        faculty = User.objects.get(roll_number="FAC01")
        self.assertEqual(faculty.role, User.Role.FACULTY)
        self.assertTrue(faculty.is_faculty)
        self.assertTrue(faculty.check_password("FAC01"))  # default = roll number

    def test_faculty_requires_branch(self):
        client = self._client()
        response = client.post(
            "/api/faculty/",
            {"roll_number": "FAC02", "full_name": "Prof. Rao"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_non_admin_cannot_manage_faculty(self):
        student = User.objects.create_user(
            roll_number="21IT01", password="x", full_name="Diya",
            branch=self.branch,
        )
        client = self._client(student)
        response = client.get("/api/faculty/")
        self.assertEqual(response.status_code, 403)

    def test_admin_updates_and_deletes_faculty(self):
        faculty = User.objects.create_user(
            roll_number="FAC01", password="x", full_name="Prof. Rao",
            branch=self.branch, role=User.Role.FACULTY,
        )
        client = self._client()
        patch = client.patch(
            f"/api/faculty/{faculty.id}/",
            {"full_name": "Prof. Krishna"},
            format="json",
        )
        self.assertEqual(patch.status_code, 200)
        faculty.refresh_from_db()
        self.assertEqual(faculty.full_name, "Prof. Krishna")
        deleted = client.delete(f"/api/faculty/{faculty.id}/")
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(User.objects.filter(roll_number="FAC01").exists())


class AdminManagementTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )

    def _client(self, user=None) -> APIClient:
        client = APIClient()
        target = user or self.admin
        login = client.post(
            "/api/auth/login/",
            {"roll_number": target.roll_number, "password": "x"},
            format="json",
        )
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        return client

    def test_admin_creates_another_admin(self):
        client = self._client()
        response = client.post(
            "/api/admins/",
            {"roll_number": "ADMIN2", "full_name": "Second Admin"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        new_admin = User.objects.get(roll_number="ADMIN2")
        self.assertEqual(new_admin.role, User.Role.SUPER_ADMIN)
        self.assertTrue(new_admin.is_super_admin)
        # Default password is the roll number.
        self.assertTrue(new_admin.check_password("ADMIN2"))

    def test_non_admin_cannot_manage_admins(self):
        faculty = User.objects.create_user(
            roll_number="FAC01", password="x", full_name="Prof. Rao",
            role=User.Role.FACULTY,
        )
        client = self._client(faculty)
        response = client.get("/api/admins/")
        self.assertEqual(response.status_code, 403)
        created = client.post(
            "/api/admins/",
            {"roll_number": "ADMIN3", "full_name": "Nope"},
            format="json",
        )
        self.assertEqual(created.status_code, 403)

    def test_admin_cannot_delete_self(self):
        client = self._client()
        response = client.delete(f"/api/admins/{self.admin.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(User.objects.filter(pk=self.admin.id).exists())

    def test_admin_can_delete_another_admin(self):
        other = User.objects.create_superuser(
            roll_number="ADMIN2", password="x", full_name="Second Admin"
        )
        client = self._client()
        response = client.delete(f"/api/admins/{other.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(User.objects.filter(pk=other.id).exists())

    def test_transfer_creates_admin_and_demotes_caller(self):
        client = self._client()
        response = client.post(
            "/api/admins/transfer/",
            {
                "roll_number": "NEWADMIN",
                "full_name": "New Boss",
                "email": "boss@college.edu",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        new_admin = User.objects.get(roll_number="NEWADMIN")
        self.assertEqual(new_admin.role, User.Role.SUPER_ADMIN)
        self.assertTrue(new_admin.check_password("NEWADMIN"))
        # The caller is demoted to a regular student and loses staff flags.
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, User.Role.STUDENT)
        self.assertTrue(self.admin.is_student)
        self.assertFalse(self.admin.is_staff)
        # The old admin's token no longer grants admin access.
        list_response = client.get("/api/admins/")
        self.assertEqual(list_response.status_code, 403)

    def test_transfer_requires_valid_roll_number(self):
        client = self._client()
        response = client.post(
            "/api/admins/transfer/",
            {"full_name": "No Roll"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_super_admin)  # nothing changed


class ResumeTests(TestCase):
    def setUp(self):
        self.branch = Branch.objects.create(name="IT", code="IT")
        self.section_a = Section.objects.create(branch=self.branch, name="A")
        self.section_b = Section.objects.create(branch=self.branch, name="B")
        self.other_branch = Branch.objects.create(name="CSE", code="CSE")
        self.other_section = Section.objects.create(branch=self.other_branch, name="A")
        self.student = User.objects.create_user(
            roll_number="21IT01", password="x", full_name="Diya",
            branch=self.branch, section=self.section_a,
        )
        self.faculty = User.objects.create_user(
            roll_number="FAC01", password="x", full_name="Prof. Rao",
            branch=self.branch, role=User.Role.FACULTY,
        )
        self.other_faculty = User.objects.create_user(
            roll_number="FAC02", password="x", full_name="Prof. Nair",
            branch=self.other_branch, role=User.Role.FACULTY,
        )
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
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

    def _resume_file(self, name="resume.pdf"):
        return SimpleUploadedFile(
            name, b"%PDF-1.4 fake resume content", content_type="application/pdf"
        )

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_student_uploads_resume(self, mock_upload):
        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/x/resume.pdf",
            "public_id": "resumes/it/a/resume.pdf",
        }
        client = self._client(self.student)
        response = client.post(
            "/api/resumes/", {"file": self._resume_file()}, format="multipart"
        )
        self.assertEqual(response.status_code, 201)
        resume = Resume.objects.get(student=self.student)
        self.assertEqual(resume.file_name, "resume.pdf")
        self.assertEqual(resume.public_id, "resumes/it/a/resume.pdf")

    @patch("apps.documents.services.cloudinary.uploader.upload")
    @patch("apps.documents.services.cloudinary.api.delete_resources")
    def test_student_replaces_resume_deletes_old_file(self, mock_delete, mock_upload):
        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/x/new.pdf",
            "public_id": "resumes/it/a/new.pdf",
        }
        Resume.objects.create(
            student=self.student, file_name="old.pdf", file_size=10,
            cloudinary_url="https://old.example/old.pdf", public_id="old_public_id",
        )
        client = self._client(self.student)
        response = client.post(
            "/api/resumes/", {"file": self._resume_file("new.pdf")}, format="multipart"
        )
        self.assertEqual(response.status_code, 201)
        resume = Resume.objects.get(student=self.student)
        self.assertEqual(resume.file_name, "new.pdf")
        mock_delete.assert_called_once_with(["old_public_id"], resource_type="raw")

    def test_student_can_delete_own_resume(self):
        Resume.objects.create(
            student=self.student, file_name="r.pdf", file_size=10,
            cloudinary_url="https://x.example/r.pdf", public_id="r_public_id",
        )
        with patch("apps.documents.services.cloudinary.api.delete_resources") as mock_delete:
            client = self._client(self.student)
            response = client.delete("/api/resumes/1/")
        self.assertEqual(response.status_code, 204)
        mock_delete.assert_called_once_with(["r_public_id"], resource_type="raw")
        self.assertFalse(Resume.objects.filter(student=self.student).exists())

    def test_student_cannot_delete_another_student_resume(self):
        other = User.objects.create_user(
            roll_number="21IT02", password="x", full_name="Arjun",
            branch=self.branch, section=self.section_a,
        )
        resume = Resume.objects.create(
            student=other, file_name="r.pdf", file_size=10,
            cloudinary_url="https://x.example/r.pdf", public_id="r_public_id",
        )
        client = self._client(self.student)
        response = client.delete(f"/api/resumes/{resume.id}/")
        self.assertEqual(response.status_code, 403)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_faculty_cannot_upload_resume(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "y"}
        client = self._client(self.faculty)
        response = client.post(
            "/api/resumes/", {"file": self._resume_file()}, format="multipart"
        )
        self.assertEqual(response.status_code, 403)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_faculty_sees_only_own_branch_resumes(self, mock_upload):
        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/x/r.pdf",
            "public_id": "r",
        }
        services.upload_resume(self.student, self._resume_file())
        other = User.objects.create_user(
            roll_number="22CSE01", password="x", full_name="Ravi",
            branch=self.other_branch, section=self.other_section,
        )
        services.upload_resume(other, self._resume_file("other.pdf"))

        client = self._client(self.faculty)
        response = client.get("/api/resumes/")
        self.assertEqual(response.status_code, 200)
        rolls = [r["student_roll"] for r in response.data["results"]]
        self.assertEqual(rolls, ["21IT01"])

        # Filtering by section narrows within the faculty's branch.
        filtered = client.get("/api/resumes/?section=%d" % self.section_a.id)
        self.assertEqual(len(filtered.data["results"]), 1)
        empty = client.get("/api/resumes/?section=%d" % self.section_b.id)
        self.assertEqual(len(empty.data["results"]), 0)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_resume_search_by_name_and_roll(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        client = self._client(self.faculty)
        by_name = client.get("/api/resumes/?search=diya")
        self.assertEqual(len(by_name.data["results"]), 1)
        by_roll = client.get("/api/resumes/?search=21IT01")
        self.assertEqual(len(by_roll.data["results"]), 1)
        none = client.get("/api/resumes/?search=zzz")
        self.assertEqual(len(none.data["results"]), 0)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_mine_returns_own_resume(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        client = self._client(self.student)
        response = client.get("/api/resumes/mine/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["student_roll"], "21IT01")

    def test_mine_404_when_no_resume(self):
        client = self._client(self.student)
        response = client.get("/api/resumes/mine/")
        self.assertEqual(response.status_code, 404)

    # -- review workflow -----------------------------------------------------

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_faculty_marks_resume_reviewed(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        resume = Resume.objects.get(student=self.student)
        client = self._client(self.faculty)
        response = client.post(
            f"/api/resumes/{resume.id}/mark_reviewed/", {}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        resume.refresh_from_db()
        self.assertTrue(resume.is_reviewed)
        self.assertEqual(resume.reviewed_by, self.faculty)
        self.assertIsNotNone(resume.reviewed_at)
        # The serialized payload exposes the review state to students too.
        self.assertTrue(response.data["is_reviewed"])
        self.assertEqual(response.data["reviewed_by_name"], "Prof. Rao")

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_faculty_unmarks_resume(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        resume = Resume.objects.get(student=self.student)
        resume.is_reviewed = True
        resume.reviewed_by = self.faculty
        resume.save()

        client = self._client(self.faculty)
        response = client.post(
            f"/api/resumes/{resume.id}/mark_reviewed/",
            {"reviewed": False},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        resume.refresh_from_db()
        self.assertFalse(resume.is_reviewed)
        self.assertIsNone(resume.reviewed_by)
        self.assertIsNone(resume.reviewed_at)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_student_cannot_mark_reviewed(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        resume = Resume.objects.get(student=self.student)
        client = self._client(self.student)
        response = client.post(
            f"/api/resumes/{resume.id}/mark_reviewed/", {}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        resume.refresh_from_db()
        self.assertFalse(resume.is_reviewed)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_faculty_cannot_mark_other_branch_resume(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        other = User.objects.create_user(
            roll_number="22CSE01", password="x", full_name="Ravi",
            branch=self.other_branch, section=self.other_section,
        )
        services.upload_resume(other, self._resume_file())
        resume = Resume.objects.get(student=other)
        client = self._client(self.faculty)
        response = client.post(
            f"/api/resumes/{resume.id}/mark_reviewed/", {}, format="json"
        )
        self.assertEqual(response.status_code, 404)
        resume.refresh_from_db()
        self.assertFalse(resume.is_reviewed)

    # -- preview (browser PDF rendering) -------------------------------------

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_faculty_previews_resume(self, mock_upload):
        mock_upload.return_value = {"secure_url": "https://storage.example/r.pdf", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        resume = Resume.objects.get(student=self.student)
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = b"%PDF-1.4 hello"
            client = self._client(self.faculty)
            response = client.get(f"/api/resumes/{resume.id}/preview/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertEqual(response.content, b"%PDF-1.4 hello")
        # The file is fetched through a SIGNED Cloudinary URL so accounts with
        # restricted delivery (the 401 cause) accept the request. The SDK uses
        # either the short (s--...) or long (sig=...) signature format.
        signed_url = mock_open.call_args[0][0]
        self.assertTrue("s--" in signed_url or "sig=" in signed_url, signed_url)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_preview_download_forces_attachment(self, mock_upload):
        mock_upload.return_value = {"secure_url": "https://storage.example/r.pdf", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        resume = Resume.objects.get(student=self.student)
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = b"%PDF-1.4 hi"
            client = self._client(self.faculty)
            response = client.get(f"/api/resumes/{resume.id}/preview/?download=1")
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        signed_url = mock_open.call_args[0][0]
        self.assertTrue("s--" in signed_url or "sig=" in signed_url, signed_url)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_check_files_flags_deleted_resume_and_hides_it(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        resume = Resume.objects.get(student=self.student)
        with patch("apps.documents.services.cloudinary_file_exists") as mock_exists:
            mock_exists.return_value = False
            client = self._client(self.faculty)
            response = client.get("/api/resumes/check-files/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["missing_ids"], [resume.id])
        resume.refresh_from_db()
        self.assertTrue(resume.is_missing)
        # The faculty list no longer shows the missing resume.
        listed = client.get("/api/resumes/")
        self.assertEqual(len(listed.data["results"]), 0)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_student_still_sees_own_missing_resume(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        resume = Resume.objects.get(student=self.student)
        resume.is_missing = True
        resume.save()
        client = self._client(self.student)
        mine = client.get("/api/resumes/mine/")
        self.assertEqual(mine.status_code, 200)
        self.assertTrue(mine.data["is_missing"])
        # Preview of a missing resume fails with a clear message.
        preview = client.get(f"/api/resumes/{resume.id}/preview/")
        self.assertEqual(preview.status_code, 404)
        self.assertIn("deleted from storage", str(preview.data))

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_student_check_flags_deleted_resume(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        resume = Resume.objects.get(student=self.student)
        with patch("apps.documents.services.cloudinary_file_exists") as mock_exists:
            mock_exists.return_value = False
            client = self._client(self.student)
            response = client.get(f"/api/resumes/{resume.id}/check/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["is_missing"])
        resume.refresh_from_db()
        self.assertTrue(resume.is_missing)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_check_files_revives_restored_resume(self, mock_upload):
        """A resume restored in Cloudinary reappears with a restored marker."""
        from datetime import timedelta

        from django.utils import timezone

        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        resume = Resume.objects.get(student=self.student)
        resume.is_missing = True
        resume.file_checked_at = timezone.now() - timedelta(days=1)
        resume.save()
        with patch("apps.documents.services.cloudinary_file_exists") as mock_exists:
            mock_exists.return_value = True
            client = self._client(self.faculty)
            response = client.get("/api/resumes/check-files/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["restored_ids"], [resume.id])
        resume.refresh_from_db()
        self.assertFalse(resume.is_missing)
        self.assertIsNotNone(resume.restored_at)
        # The faculty list shows the restored resume again.
        listed = client.get("/api/resumes/")
        self.assertEqual(len(listed.data["results"]), 1)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_student_check_revives_restored_resume(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        resume = Resume.objects.get(student=self.student)
        resume.is_missing = True
        resume.save()
        with patch("apps.documents.services.cloudinary_file_exists") as mock_exists:
            mock_exists.return_value = True
            client = self._client(self.student)
            response = client.get(f"/api/resumes/{resume.id}/check/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["is_missing"])
        self.assertIsNotNone(response.data["restored_at"])
        resume.refresh_from_db()
        self.assertFalse(resume.is_missing)
        self.assertIsNotNone(resume.restored_at)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_student_cannot_check_others_resume(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        other = User.objects.create_user(
            roll_number="21IT02", password="x", full_name="Arjun",
            branch=self.branch, section=self.section_a,
        )
        services.upload_resume(other, self._resume_file())
        resume = Resume.objects.get(student=other)
        client = self._client(self.student)
        response = client.get(f"/api/resumes/{resume.id}/check/")
        self.assertEqual(response.status_code, 403)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_preview_surfaces_cloudinary_block(self, mock_upload):
        mock_upload.return_value = {"secure_url": "https://storage.example/r.pdf", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        resume = Resume.objects.get(student=self.student)
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.side_effect = urllib.error.HTTPError(
                "https://x", 401, "Unauthorized", hdrs=None, fp=None
            )
            client = self._client(self.faculty)
            response = client.get(f"/api/resumes/{resume.id}/preview/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Cloudinary", str(response.data))

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_student_previews_own_resume(self, mock_upload):
        mock_upload.return_value = {"secure_url": "https://storage.example/r.pdf", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        resume = Resume.objects.get(student=self.student)
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = b"%PDF-1.4 mine"
            client = self._client(self.student)
            response = client.get(f"/api/resumes/{resume.id}/preview/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_student_cannot_preview_others_resume(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        other = User.objects.create_user(
            roll_number="21IT02", password="x", full_name="Arjun",
            branch=self.branch, section=self.section_a,
        )
        services.upload_resume(other, self._resume_file())
        resume = Resume.objects.get(student=other)
        client = self._client(self.student)
        response = client.get(f"/api/resumes/{resume.id}/preview/")
        self.assertEqual(response.status_code, 403)

    # -- bulk review ---------------------------------------------------------

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_faculty_marks_all_branch_resumes_reviewed(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        sec_b = User.objects.create_user(
            roll_number="21IT03", password="x", full_name="Bhavya",
            branch=self.branch, section=self.section_b,
        )
        services.upload_resume(sec_b, self._resume_file("b.pdf"))
        other_branch = User.objects.create_user(
            roll_number="22CSE01", password="x", full_name="Ravi",
            branch=self.other_branch, section=self.other_section,
        )
        services.upload_resume(other_branch, self._resume_file("o.pdf"))

        client = self._client(self.faculty)
        response = client.post("/api/resumes/mark_all_reviewed/", {}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["updated"], 2)  # own branch only
        self.assertTrue(Resume.objects.get(student=self.student).is_reviewed)
        self.assertTrue(Resume.objects.get(student=sec_b).is_reviewed)
        # The other branch's resume is untouched.
        self.assertFalse(Resume.objects.get(student=other_branch).is_reviewed)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_mark_all_respects_section_filter(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())  # section A
        sec_b = User.objects.create_user(
            roll_number="21IT03", password="x", full_name="Bhavya",
            branch=self.branch, section=self.section_b,
        )
        services.upload_resume(sec_b, self._resume_file("b.pdf"))

        client = self._client(self.faculty)
        response = client.post(
            "/api/resumes/mark_all_reviewed/?section=%d" % self.section_a.id,
            {}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["updated"], 1)
        self.assertTrue(Resume.objects.get(student=self.student).is_reviewed)
        self.assertFalse(Resume.objects.get(student=sec_b).is_reviewed)

    def test_student_cannot_mark_all(self):
        client = self._client(self.student)
        response = client.post("/api/resumes/mark_all_reviewed/", {}, format="json")
        self.assertEqual(response.status_code, 403)

    # -- ZIP download ---------------------------------------------------------

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_faculty_downloads_branch_resumes_zip(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file("diya.pdf"))
        sec_b = User.objects.create_user(
            roll_number="21IT03", password="x", full_name="Bhavya",
            branch=self.branch, section=self.section_b,
        )
        services.upload_resume(sec_b, self._resume_file("bhavya.pdf"))
        other = User.objects.create_user(
            roll_number="22CSE01", password="x", full_name="Ravi",
            branch=self.other_branch, section=self.other_section,
        )
        services.upload_resume(other, self._resume_file("ravi.pdf"))

        import io
        import zipfile

        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = b"%PDF-1.4 x"
            client = self._client(self.faculty)
            response = client.get("/api/resumes/download_zip/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/zip")
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            self.assertEqual(sorted(zf.namelist()), ["bhavya.pdf", "diya.pdf"])

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_zip_respects_section_filter(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file("diya.pdf"))
        sec_b = User.objects.create_user(
            roll_number="21IT03", password="x", full_name="Bhavya",
            branch=self.branch, section=self.section_b,
        )
        services.upload_resume(sec_b, self._resume_file("bhavya.pdf"))

        import io
        import zipfile

        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = b"%PDF-1.4 x"
            client = self._client(self.faculty)
            response = client.get(
                "/api/resumes/download_zip/?section=%d" % self.section_a.id
            )
        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            self.assertEqual(zf.namelist(), ["diya.pdf"])

    def test_student_cannot_download_zip(self):
        client = self._client(self.student)
        response = client.get("/api/resumes/download_zip/")
        self.assertEqual(response.status_code, 403)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_replacing_resume_resets_review_status(self, mock_upload):
        mock_upload.side_effect = [
            {"secure_url": "https://x.example/old.pdf", "public_id": "old"},
            {"secure_url": "https://x.example/new.pdf", "public_id": "new"},
        ]
        services.upload_resume(self.student, self._resume_file("old.pdf"))
        from django.utils import timezone

        resume = Resume.objects.get(student=self.student)
        resume.is_reviewed = True
        resume.reviewed_by = self.faculty
        resume.restored_at = timezone.now()
        resume.ai_status = Resume.AiStatus.COMPLETE
        resume.ai_score = 80
        resume.ai_analysis = {"summary": "old"}
        resume.save()

        # Replacing the file clears the review, any "Restored" badge and the
        # old file's AI analysis (it no longer applies to the new version).
        services.upload_resume(self.student, self._resume_file("new.pdf"))
        resume.refresh_from_db()
        self.assertEqual(resume.file_name, "new.pdf")
        self.assertFalse(resume.is_reviewed)
        self.assertIsNone(resume.reviewed_by)
        self.assertIsNone(resume.reviewed_at)
        self.assertIsNone(resume.restored_at)
        self.assertEqual(resume.ai_status, Resume.AiStatus.PENDING)
        self.assertIsNone(resume.ai_score)
        self.assertIsNone(resume.ai_analysis)
        self.assertIsNone(resume.ai_match)

    # -- AI resume review ----------------------------------------------------

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_student_analyzes_resume_and_gets_quality_and_drive_matches(self, mock_upload):
        from datetime import timedelta

        from django.utils import timezone

        from apps.placements.models import AiUsageLog, Drive

        mock_upload.return_value = {
            "secure_url": "https://storage.example/r.pdf", "public_id": "r"
        }
        services.upload_resume(self.student, self._resume_file())
        resume = Resume.objects.get(student=self.student)

        drive = Drive.objects.create(
            company_name="TCS",
            last_date_to_apply=timezone.localdate() + timedelta(days=5),
            posted_by=self.admin,
        )
        quality = {
            "score": 84,
            "summary": "Solid resume with project work.",
            "strengths": ["Python", "clear layout"],
            "improvements": ["Add measurable results"],
            "skills": ["Python", "SQL"],
            "ats_keywords": ["Git"],
        }
        matches = {"matches": [{"drive_id": drive.id, "score": 90, "reason": "Python fits"}]}

        def fake_ai(prompt, text, max_tokens=1024, usage_callback=None):
            # Like the real client, fire the usage callback with token counts.
            if usage_callback:
                usage_callback(100, 40)
            return fake_ai.responses.pop(0)

        fake_ai.responses = [quality, matches]

        with (
            patch("apps.placements.resume_ai.extract_resume_text", return_value="Python project, SQL."),
            patch("apps.placements.resume_ai.ai_json", side_effect=fake_ai),
        ):
            client = self._client(self.student)
            response = client.post(f"/api/resumes/{resume.id}/analyze/", {}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        resume.refresh_from_db()
        self.assertEqual(resume.ai_status, Resume.AiStatus.COMPLETE)
        self.assertEqual(resume.ai_score, 84)
        self.assertEqual(resume.ai_analysis["skills"], ["Python", "SQL"])
        self.assertEqual(resume.ai_match[str(drive.id)]["score"], 90)
        self.assertEqual(resume.ai_match[str(drive.id)]["company_name"], "TCS")
        self.assertIsNotNone(resume.ai_analyzed_at)
        # The AI calls are tracked against the student's own credits.
        self.assertTrue(
            AiUsageLog.objects.filter(
                user=self.student, action=AiUsageLog.Action.RESUME
            ).exists()
        )

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_cr_cannot_analyze_resumes(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        resume = Resume.objects.get(student=self.student)
        cr = User.objects.create_user(
            roll_number="CR01", password="x", full_name="CR",
            branch=self.branch, section=self.section_a, role=User.Role.CR,
        )
        client = self._client(cr)
        response = client.post(f"/api/resumes/{resume.id}/analyze/", {}, format="json")
        self.assertEqual(response.status_code, 403)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_student_cannot_analyze_another_students_resume(self, mock_upload):
        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        other = User.objects.create_user(
            roll_number="21IT02", password="x", full_name="Arjun",
            branch=self.branch, section=self.section_a,
        )
        services.upload_resume(other, self._resume_file())
        resume = Resume.objects.get(student=other)
        client = self._client(self.student)
        response = client.post(f"/api/resumes/{resume.id}/analyze/", {}, format="json")
        self.assertEqual(response.status_code, 403)

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_analyze_surfaces_ai_errors_and_keeps_status(self, mock_upload):
        from apps.placements.ai import AiError

        mock_upload.return_value = {"secure_url": "x", "public_id": "r"}
        services.upload_resume(self.student, self._resume_file())
        resume = Resume.objects.get(student=self.student)
        with (
            patch("apps.placements.resume_ai.extract_resume_text", return_value="Python"),
            patch("apps.placements.resume_ai.ai_json", side_effect=AiError("quota exceeded")),
        ):
            client = self._client(self.student)
            response = client.post(f"/api/resumes/{resume.id}/analyze/", {}, format="json")
        self.assertEqual(response.status_code, 502)
        self.assertIn("quota exceeded", response.data["detail"])
        resume.refresh_from_db()
        self.assertEqual(resume.ai_status, Resume.AiStatus.PENDING)  # unchanged on failure
