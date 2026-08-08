from types import SimpleNamespace

from django.test import TestCase
from rest_framework.test import APIClient

from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile

from apps.accounts.models import Resume, User
from apps.college.models import Branch, Category, Section, Semester, Subject
from apps.core.models import AuditLog, ContactRequest, Notification, SiteSetting
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


class NotificationApiTests(TestCase):
    """The notifications bell: scoped list, unread count, read actions."""

    def setUp(self):
        self.student = User.objects.create_user(
            roll_number="21CSE01", password="x", full_name="Diya"
        )
        self.other = User.objects.create_user(
            roll_number="21CSE02", password="x", full_name="Arjun"
        )

    def _client(self, user):
        from rest_framework_simplejwt.tokens import AccessToken

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
        return client

    def _notify(self, user, title):
        return Notification.objects.create(
            user=user, kind="DOCUMENT_UPLOAD", title=title, message="m", link="/documents"
        )

    def test_notifications_are_scoped_to_the_user(self):
        self._notify(self.student, "A")
        self._notify(self.other, "B")
        response = self._client(self.student).get("/api/notifications/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["title"], "A")

    def test_unread_count_and_mark_read(self):
        self._notify(self.student, "n1")
        self._notify(self.student, "n2")
        self._notify(self.student, "n3")
        count = self._client(self.student).get("/api/notifications/unread_count/")
        self.assertEqual(count.data["count"], 3)
        first = Notification.objects.filter(user=self.student).first()
        self._client(self.student).post(f"/api/notifications/{first.id}/mark_read/")
        first.refresh_from_db()
        self.assertTrue(first.read)
        count = self._client(self.student).get("/api/notifications/unread_count/")
        self.assertEqual(count.data["count"], 2)

    def test_read_all(self):
        self._notify(self.student, "n1")
        self._notify(self.student, "n2")
        self._client(self.student).post("/api/notifications/read_all/")
        self.assertEqual(
            Notification.objects.filter(user=self.student, read=False).count(), 0
        )

    def test_cannot_mark_others_notification(self):
        n = self._notify(self.other, "private")
        self._client(self.student).post(f"/api/notifications/{n.id}/mark_read/")
        n.refresh_from_db()
        self.assertFalse(n.read)  # scoped update is a no-op

    def test_unread_scope_filter(self):
        n_read = self._notify(self.student, "read")
        n_read.read = True
        n_read.save(update_fields=["read"])
        self._notify(self.student, "unread")
        response = self._client(self.student).get("/api/notifications/?scope=unread")
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["title"], "unread")

    def test_all_scope_returns_full_history(self):
        for i in range(55):
            self._notify(self.student, f"n{i}")
        capped = self._client(self.student).get("/api/notifications/")
        self.assertEqual(len(capped.data), 50)  # the bell only shows the newest 50
        full = self._client(self.student).get("/api/notifications/?scope=all")
        self.assertEqual(len(full.data), 55)  # the history page gets everything


class NotificationTriggerTests(TestCase):
    """Uploads fan out notifications to the right people."""

    def setUp(self):
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )
        self.branch = Branch.objects.create(name="CSE")
        self.section_a = Section.objects.create(branch=self.branch, name="A")
        self.section_b = Section.objects.create(branch=self.branch, name="B")
        self.semester = Semester.objects.create(name="3-1", order=5)
        self.category = Category.objects.create(name="Notes")
        self.subject = Subject.objects.create(
            name="DBMS", semester=self.semester, branch=self.branch
        )
        self.student = User.objects.create_user(
            roll_number="21CSE01", password="x", full_name="Diya",
            branch=self.branch, section=self.section_a,
        )
        self.other_student = User.objects.create_user(
            roll_number="21CSE02", password="x", full_name="Arjun",
            branch=self.branch, section=self.section_b,
        )
        self.cr = User.objects.create_user(
            roll_number="cr1", password="x", full_name="CR",
            branch=self.branch, section=self.section_a, role=User.Role.CR,
        )
        self.faculty = User.objects.create_user(
            roll_number="FAC01", password="x", full_name="Prof",
            branch=self.branch, role=User.Role.FACULTY,
        )

    def _pdf(self):
        return SimpleUploadedFile(
            "notes.pdf", b"%PDF-1.4 fake", content_type="application/pdf"
        )

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_document_upload_notifies_section_students_and_cr(self, mock_upload):
        mock_upload.return_value = {
            "secure_url": "https://x.example/f.pdf", "public_id": "p1"
        }
        from apps.documents.services import create_document

        create_document(
            {
                "title": "DBMS Unit 1",
                "description": "",
                "branch": self.branch,
                "sections": [self.section_a],
                "semester": self.semester,
                "category": self.category,
                "subject": self.subject,
            },
            self._pdf(),
            self.cr,
        )
        notifs = Notification.objects.filter(kind="DOCUMENT_UPLOAD")
        user_ids = set(notifs.values_list("user_id", flat=True))
        self.assertEqual(user_ids, {self.student.id, self.cr.id})
        self.assertNotIn(self.other_student.id, user_ids)
        self.assertNotIn(self.faculty.id, user_ids)
        n = notifs.first()
        self.assertEqual(n.link, "/documents")

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_sharing_to_a_section_notifies_its_students(self, mock_upload):
        mock_upload.return_value = {
            "secure_url": "https://x.example/f.pdf", "public_id": "p1"
        }
        from apps.documents.models import Document
        from apps.documents.services import create_document, share_document

        doc = create_document(
            {
                "title": "DBMS Unit 1",
                "description": "",
                "branch": self.branch,
                "sections": [self.section_a],
                "semester": self.semester,
                "category": self.category,
                "subject": self.subject,
            },
            self._pdf(),
            self.admin,
        )
        share_document(doc, [self.section_b], self.admin)
        # Section B's student now has a DOCUMENT_UPLOAD notification.
        self.assertTrue(
            Notification.objects.filter(
                user=self.other_student, kind="DOCUMENT_UPLOAD"
            ).exists()
        )

    @patch("apps.documents.services.cloudinary.uploader.upload")
    def test_resume_upload_notifies_branch_faculty(self, mock_upload):
        mock_upload.return_value = {"secure_url": "https://x.example/r.pdf", "public_id": "r"}
        from apps.accounts.services import upload_resume

        upload_resume(self.student, self._pdf())
        notifs = Notification.objects.filter(kind="RESUME_UPLOAD")
        self.assertEqual(set(notifs.values_list("user_id", flat=True)), {self.faculty.id})
        self.assertEqual(notifs.first().link, "/faculty/resumes")


class ContactRequestTests(TestCase):
    """Faculty/CR 'approach admin' flow with admin notifications."""

    def setUp(self):
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )
        self.branch = Branch.objects.create(name="CSE")
        self.faculty = User.objects.create_user(
            roll_number="FAC01", password="x", full_name="Prof",
            branch=self.branch, role=User.Role.FACULTY,
        )
        self.cr = User.objects.create_user(
            roll_number="cr1", password="x", full_name="CR",
            branch=self.branch, role=User.Role.CR,
        )
        self.student = User.objects.create_user(
            roll_number="21CSE01", password="x", full_name="Diya",
            branch=self.branch,
        )

    def _client(self, user):
        from rest_framework_simplejwt.tokens import AccessToken

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
        return client

    def test_faculty_contacts_admin_and_admin_is_notified(self):
        response = self._client(self.faculty).post(
            "/api/contact-requests/",
            {"subject": "Add a subject", "message": "Please add CS501 for 4-1."},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(ContactRequest.objects.count(), 1)
        n = Notification.objects.filter(user=self.admin, kind="CONTACT_ADMIN").first()
        self.assertIsNotNone(n)
        self.assertIn("Add a subject", n.title)

    def test_cr_can_contact_admin(self):
        response = self._client(self.cr).post(
            "/api/contact-requests/",
            {"subject": "Issue", "message": "Help needed"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

    def test_student_cannot_contact_admin(self):
        response = self._client(self.student).post(
            "/api/contact-requests/",
            {"subject": "Hi", "message": "Can I?"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_users_only_see_own_requests_admin_sees_all(self):
        self._client(self.faculty).post(
            "/api/contact-requests/",
            {"subject": "Mine", "message": "x"},
            format="json",
        )
        other_faculty = User.objects.create_user(
            roll_number="FAC02", password="x", full_name="Prof2",
            branch=self.branch, role=User.Role.FACULTY,
        )
        self._client(other_faculty).post(
            "/api/contact-requests/",
            {"subject": "Other", "message": "y"},
            format="json",
        )
        own = self._client(self.faculty).get("/api/contact-requests/")
        self.assertEqual(len(own.data), 1)
        self.assertEqual(own.data[0]["subject"], "Mine")
        all_requests = self._client(self.admin).get("/api/contact-requests/")
        self.assertEqual(len(all_requests.data), 2)

    def test_admin_resolves_request(self):
        req = self._client(self.faculty).post(
            "/api/contact-requests/",
            {"subject": "Help", "message": "Need assistance"},
            format="json",
        ).data
        resolved = self._client(self.admin).post(
            f"/api/contact-requests/{req['id']}/resolve/"
        )
        self.assertEqual(resolved.status_code, 200)
        self.assertEqual(resolved.data["status"], "RESOLVED")
        # The faculty member now sees it as resolved.
        own = self._client(self.faculty).get("/api/contact-requests/")
        self.assertEqual(own.data[0]["status"], "RESOLVED")

    def test_only_admin_can_resolve(self):
        req = self._client(self.faculty).post(
            "/api/contact-requests/",
            {"subject": "Help", "message": "x"},
            format="json",
        ).data
        response = self._client(self.faculty).post(
            f"/api/contact-requests/{req['id']}/resolve/"
        )
        self.assertEqual(response.status_code, 403)
