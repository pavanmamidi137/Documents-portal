from types import SimpleNamespace

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Resume, User
from apps.college.models import Branch, Section
from apps.core.models import AuditLog, SiteSetting
from apps.core.permissions import IsSuperAdmin, IsSuperAdminOrCR, IsStudent
from apps.core.utils import csv_safe
from apps.core.views_settings import get_site_theme


class CsvSafeTests(TestCase):
    def test_neutralizes_formula_cells(self):
        self.assertEqual(csv_safe("=cmd()"), "'=cmd()")
        self.assertEqual(csv_safe("+SUM(A1)"), "'+SUM(A1)")
        self.assertEqual(csv_safe("-100"), "'-100")
        self.assertEqual(csv_safe("@import"), "'@import")

    def test_leaves_normal_values_alone(self):
        self.assertEqual(csv_safe("Aarav"), "Aarav")
        self.assertEqual(csv_safe("21CSE01"), "21CSE01")
        self.assertEqual(csv_safe(""), "")


class PermissionTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(roll_number="admin", password="x", full_name="Admin")
        self.cr = User.objects.create_user(
            roll_number="cr1", password="x", full_name="CR", role=User.Role.CR
        )
        self.student = User.objects.create_user(
            roll_number="st1", password="x", full_name="Student"
        )

    def _user_permission(self, cls, user):
        return cls().has_permission(SimpleNamespace(user=user), None)

    def test_role_permissions(self):
        self.assertTrue(self._user_permission(IsSuperAdmin, self.admin))
        self.assertFalse(self._user_permission(IsSuperAdmin, self.cr))
        self.assertFalse(self._user_permission(IsSuperAdmin, self.student))
        self.assertTrue(self._user_permission(IsSuperAdminOrCR, self.admin))
        self.assertTrue(self._user_permission(IsSuperAdminOrCR, self.cr))
        self.assertFalse(self._user_permission(IsSuperAdminOrCR, self.student))
        self.assertTrue(self._user_permission(IsStudent, self.student))
        self.assertFalse(self._user_permission(IsStudent, self.cr))


class SiteThemeTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(roll_number="admin", password="x", full_name="Admin")
        self.cr = User.objects.create_user(
            roll_number="cr1", password="x", full_name="CR", role=User.Role.CR
        )

    def _token(self, user):
        from rest_framework_simplejwt.tokens import AccessToken

        return str(AccessToken.for_user(user))

    def test_public_get_returns_default_theme(self):
        client = APIClient()
        response = client.get("/api/site-theme/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["theme"], "default")

    def test_admin_can_change_theme(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(self.admin)}")
        response = client.put(
            "/api/site-theme/", {"theme": "flame"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["theme"], "flame")
        self.assertEqual(get_site_theme(), "flame")
        self.assertEqual(SiteSetting.objects.get(key="site_theme").value, "flame")

        # A fresh anonymous request now sees the new theme.
        anon = APIClient()
        self.assertEqual(anon.get("/api/site-theme/").data["theme"], "flame")

    def test_non_admin_cannot_change_theme(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(self.cr)}")
        response = client.put("/api/site-theme/", {"theme": "ocean"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(get_site_theme(), "default")

    def test_unknown_theme_rejected(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(self.admin)}")
        response = client.put("/api/site-theme/", {"theme": "neon"}, format="json")
        self.assertEqual(response.status_code, 400)


class AuditLogClearTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(roll_number="admin", password="x", full_name="Admin")
        self.cr = User.objects.create_user(
            roll_number="cr1", password="x", full_name="CR", role=User.Role.CR
        )
        for i in range(5):
            AuditLog.objects.create(actor=self.admin, action="CREATE", target_type="Branch", details={"n": i})

    def _client(self, user=None):
        client = APIClient()
        if user:
            from rest_framework_simplejwt.tokens import AccessToken

            client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
        return client

    def test_clear_selected(self):
        client = self._client(self.admin)
        ids = list(AuditLog.objects.values_list("id", flat=True)[:2])
        response = client.post("/api/audit-logs/clear/", {"ids": ids}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deleted"], 2)
        # The clear action itself is logged afterwards, so 5 - 2 + 1 = 4.
        self.assertEqual(AuditLog.objects.count(), 4)

    def test_clear_all(self):
        client = self._client(self.admin)
        response = client.post("/api/audit-logs/clear/", {"all": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deleted"], 5)
        # The clearing action is logged after the wipe, so exactly 1 survives.
        self.assertEqual(AuditLog.objects.count(), 1)

    def test_requires_payload(self):
        client = self._client(self.admin)
        response = client.post("/api/audit-logs/clear/", {}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_cr_cannot_clear(self):
        client = self._client(self.cr)
        response = client.post("/api/audit-logs/clear/", {"all": True}, format="json")
        self.assertEqual(response.status_code, 403)


class FacultyDashboardTests(TestCase):
    def setUp(self):
        self.branch = Branch.objects.create(name="IT", code="IT")
        self.section_a = Section.objects.create(branch=self.branch, name="A")
        self.section_b = Section.objects.create(branch=self.branch, name="B")
        self.other_branch = Branch.objects.create(name="CSE", code="CSE")
        self.faculty = User.objects.create_user(
            roll_number="FAC01", password="x", full_name="Prof. Rao",
            branch=self.branch, role=User.Role.FACULTY,
        )
        self.student = User.objects.create_user(
            roll_number="21IT01", password="x", full_name="Diya",
            branch=self.branch, section=self.section_a, role=User.Role.STUDENT,
        )
        User.objects.create_user(
            roll_number="CR01", password="x", full_name="Charan",
            branch=self.branch, section=self.section_a, role=User.Role.CR,
        )
        User.objects.create_user(
            roll_number="22CSE01", password="x", full_name="Ravi",
            branch=self.other_branch, role=User.Role.STUDENT,
        )
        Resume.objects.create(
            student=self.student, file_name="r.pdf", file_size=10,
            cloudinary_url="https://x.example/r.pdf", public_id="r",
            is_reviewed=False,
        )

    def _client(self):
        client = APIClient()
        from rest_framework_simplejwt.tokens import AccessToken

        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.faculty)}")
        return client

    def test_faculty_dashboard_totals_cover_own_branch(self):
        response = self._client().get("/api/dashboard/")
        self.assertEqual(response.status_code, 200)
        totals = response.data["totals"]
        self.assertEqual(totals["branches"], 1)
        self.assertEqual(totals["sections"], 2)
        self.assertEqual(totals["crs"], 1)
        self.assertEqual(totals["students"], 1)
        self.assertEqual(totals["resumes"], 1)
        self.assertEqual(totals["pending_resumes"], 1)
        self.assertEqual(response.data["role"], "FACULTY")
