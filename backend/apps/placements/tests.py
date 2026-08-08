from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from apps.accounts.models import User
from apps.core.models import Notification

from .models import Drive


class DriveApiTests(APITestCase):
    """Placement drives: writes by role, eligibility, lifecycle, cleanup."""

    def setUp(self):
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )
        self.faculty = User.objects.create_user(
            roll_number="FAC01", password="x", full_name="Prof",
            role=User.Role.FACULTY,
        )
        self.cr = User.objects.create_user(
            roll_number="cr1", password="x", full_name="CR", role=User.Role.CR
        )
        self.student = User.objects.create_user(
            roll_number="21CSE01", password="x", full_name="Diya"
        )
        self.student2 = User.objects.create_user(
            roll_number="21CSE02", password="x", full_name="Arjun"
        )
        self.today = timezone.localdate()

    def _client(self, user):
        from rest_framework_simplejwt.tokens import AccessToken

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
        return client

    def _payload(self, **overrides):
        data = {
            "company_name": "TCS",
            "role": "Software Engineer",
            "location": "Hyderabad",
            "package": "6 LPA",
            "drive_link": "https://apply.example.com/tcs",
            "description": "Hiring freshers.",
            "eligibility": "B.Tech CSE, 60% aggregate",
            "eligible_roll_numbers": "21CSE01, 21CSE02",
            "last_date_to_apply": (self.today + timedelta(days=10)).isoformat(),
        }
        data.update(overrides)
        return data

    # ---- Who can post ----

    def test_admin_faculty_and_cr_can_post(self):
        for user in (self.admin, self.faculty, self.cr):
            response = self._client(user).post("/api/drives/", self._payload(), format="json")
            self.assertEqual(response.status_code, 201, response.data)
            self.assertEqual(response.data["posted_by"], user.id)

    def test_student_cannot_post(self):
        response = self._client(self.student).post("/api/drives/", self._payload(), format="json")
        self.assertEqual(response.status_code, 403)

    def test_anonymous_cannot_read_or_write(self):
        anon = APIClient()
        self.assertEqual(anon.get("/api/drives/").status_code, 401)
        self.assertEqual(anon.post("/api/drives/", self._payload(), format="json").status_code, 401)

    # ---- Edit/delete ownership ----

    def test_only_poster_or_admin_can_edit_or_delete(self):
        drive = Drive.objects.create(
            company_name="Infosys", last_date_to_apply=self.today + timedelta(days=5),
            posted_by=self.faculty,
        )
        url = f"/api/drives/{drive.id}/"

        # The faculty poster can edit & delete.
        self.assertEqual(
            self._client(self.faculty).patch(url, {"package": "7 LPA"}, format="json").status_code,
            200,
        )
        # Another faculty cannot.
        other_faculty = User.objects.create_user(
            roll_number="FAC02", password="x", full_name="Other", role=User.Role.FACULTY
        )
        self.assertEqual(
            self._client(other_faculty).patch(url, {"package": "8 LPA"}, format="json").status_code,
            403,
        )
        # A CR cannot either.
        self.assertEqual(
            self._client(self.cr).delete(url).status_code, 403
        )
        # The admin can.
        self.assertEqual(self._client(self.admin).delete(url).status_code, 204)
        self.assertFalse(Drive.objects.filter(pk=drive.id).exists())

    # ---- Eligibility tag ----

    def test_eligible_tag_for_students_in_the_list(self):
        drive = Drive.objects.create(
            company_name="TCS", last_date_to_apply=self.today + timedelta(days=5),
            eligible_roll_numbers="21CSE01\n21CSE03",
            posted_by=self.admin,
        )
        data = self._client(self.student).get(f"/api/drives/{drive.id}/").data
        self.assertTrue(data["is_eligible_for_me"])  # 21CSE01 is in the list
        data2 = self._client(self.student2).get(f"/api/drives/{drive.id}/").data
        self.assertFalse(data2["is_eligible_for_me"])  # 21CSE02 is not
        data3 = self._client(self.faculty).get(f"/api/drives/{drive.id}/").data
        self.assertIsNone(data3["is_eligible_for_me"])  # non-students get null

    # ---- Lifecycle: open / expired / 30-day cleanup ----

    def test_open_and_expired_status_and_expiry_date(self):
        drive = Drive.objects.create(
            company_name="OpenCo", last_date_to_apply=self.today + timedelta(days=3),
            posted_by=self.admin,
        )
        expired = Drive.objects.create(
            company_name="GoneCo", last_date_to_apply=self.today - timedelta(days=1),
            posted_by=self.admin,
        )
        open_data = self._client(self.student).get(f"/api/drives/{drive.id}/").data
        self.assertEqual(open_data["status"], "OPEN")
        self.assertEqual(open_data["expires_at"], (self.today + timedelta(days=3 + 30)).isoformat())
        expired_data = self._client(self.student).get(f"/api/drives/{expired.id}/").data
        self.assertEqual(expired_data["status"], "EXPIRED")

        # Tabs: open list only has the open drive, expired list only the expired one.
        open_list = self._client(self.student).get("/api/drives/?status=open").data
        self.assertEqual([d["id"] for d in open_list], [drive.id])
        expired_list = self._client(self.student).get("/api/drives/?status=expired").data
        self.assertEqual([d["id"] for d in expired_list], [expired.id])

    def test_drives_are_deleted_31_days_after_expiry(self):
        # Expired 31 days ago -> past the 30-day grace -> removed on next list.
        Drive.objects.create(
            company_name="OldCo",
            last_date_to_apply=self.today - timedelta(days=31),
            posted_by=self.admin,
        )
        # Expired 10 days ago -> still within the grace period -> stays.
        keep = Drive.objects.create(
            company_name="KeepCo",
            last_date_to_apply=self.today - timedelta(days=10),
            posted_by=self.admin,
        )
        remaining = self._client(self.student).get("/api/drives/?status=expired").data
        self.assertEqual([d["company_name"] for d in remaining], ["KeepCo"])

    def test_cleanup_command(self):
        from io import StringIO

        from django.core.management import call_command

        Drive.objects.create(
            company_name="OldCo",
            last_date_to_apply=self.today - timedelta(days=40),
            posted_by=self.admin,
        )
        Drive.objects.create(
            company_name="FreshCo",
            last_date_to_apply=self.today - timedelta(days=5),
            posted_by=self.admin,
        )
        call_command("cleanup_expired_drives", stdout=StringIO())
        self.assertEqual(list(Drive.objects.values_list("company_name", flat=True)), ["FreshCo"])

    # ---- Notifications ----

    def test_new_drive_notifies_all_students(self):
        self._client(self.admin).post("/api/drives/", self._payload(), format="json")
        notifs = Notification.objects.filter(kind=Notification.Kind.DRIVE)
        self.assertEqual(
            set(notifs.values_list("user_id", flat=True)),
            {self.student.id, self.student2.id},
        )
        self.assertEqual(notifs.first().link, "/placements")
        self.assertIn("TCS", notifs.first().title)

    def test_editing_a_drive_does_not_re_notify(self):
        drive = Drive.objects.create(
            company_name="TCS", last_date_to_apply=self.today + timedelta(days=10),
            posted_by=self.admin,
        )
        self.assertEqual(Notification.objects.filter(kind=Notification.Kind.DRIVE).count(), 0)
        response = self._client(self.admin).patch(
            f"/api/drives/{drive.id}/", {"package": "7 LPA"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        # Only new posts notify - edits must not spam every student.
        self.assertEqual(Notification.objects.filter(kind=Notification.Kind.DRIVE).count(), 0)
