import io
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from openai import RateLimitError
from rest_framework.test import APIClient, APITestCase

from apps.accounts.models import User
from apps.core.models import Notification

from .ai import AiError
from .models import AiUsageLog, Drive, DriveChatMessage


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

    def test_new_drive_notifies_all_students_and_crs(self):
        """CRs are students too - they get the same drive notification."""
        self._client(self.admin).post("/api/drives/", self._payload(), format="json")
        notifs = Notification.objects.filter(kind=Notification.Kind.DRIVE)
        self.assertEqual(
            set(notifs.values_list("user_id", flat=True)),
            {self.student.id, self.student2.id, self.cr.id},
        )
        # The notification deep-links to the drive detail page.
        self.assertTrue(notifs.first().link.startswith("/placements/"))
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

    # ---- Auto match refresh when a drive is posted ----

    @patch("apps.placements.views.maybe_refresh_drive_matches")
    def test_new_drive_triggers_auto_match_refresh(self, mock_refresh):
        response = self._client(self.faculty).post(
            "/api/drives/", self._payload(), format="json"
        )
        self.assertEqual(response.status_code, 201)
        drive = Drive.objects.get(company_name="TCS")
        mock_refresh.assert_called_once()
        self.assertEqual(mock_refresh.call_args.args[0].id, drive.id)
        self.assertEqual(mock_refresh.call_args.args[1], self.faculty)

    def test_refresh_matches_for_new_drive_updates_only_analyzed_resumes(self):
        from apps.accounts.models import Resume
        from apps.placements.resume_ai import refresh_matches_for_drive

        resume = Resume.objects.create(
            student=self.student, file_name="r.pdf", file_size=10,
            cloudinary_url="https://x/r.pdf", public_id="r",
            ai_status=Resume.AiStatus.COMPLETE, ai_score=70,
            ai_analysis={"summary": "Python developer", "skills": ["Python", "SQL"]},
        )
        # An unanalyzed resume must be left untouched.
        Resume.objects.create(
            student=self.student2, file_name="r2.pdf", file_size=10,
            cloudinary_url="https://x/r2.pdf", public_id="r2",
        )
        drive = Drive.objects.create(
            company_name="TCS", last_date_to_apply=self.today + timedelta(days=5),
            posted_by=self.admin,
        )

        def fake_match(prompt, text, max_tokens=1024, usage_callback=None, **kwargs):
            if usage_callback:
                usage_callback(30, 10)
            return {"matches": [{"drive_id": drive.id, "score": 88, "reason": "Python fits"}]}

        with (
            patch("apps.placements.resume_ai.ai_json", side_effect=fake_match),
            patch("apps.placements.resume_ai.get_api_key", return_value="test-key"),
        ):
            updated = refresh_matches_for_drive(drive, self.admin)
        self.assertEqual(updated, 1)
        resume.refresh_from_db()
        entry = resume.ai_match[str(drive.id)]
        self.assertEqual(entry["score"], 88)
        self.assertEqual(entry["reason"], "Python fits")
        self.assertEqual(entry["company_name"], "TCS")
        self.assertIsNone(Resume.objects.get(student=self.student2).ai_match)

    def test_refresh_drive_matches_command_runs_for_analyzed_resumes(self):
        from io import StringIO

        from django.core.management import call_command

        with patch(
            "apps.placements.resume_ai.refresh_all_matches", return_value=2
        ) as mock_refresh:
            call_command("refresh_drive_matches", stdout=StringIO())
        mock_refresh.assert_called_once()
        # The command charges the college's admin, not an individual poster.
        self.assertEqual(mock_refresh.call_args.args[0], self.admin)

    # ---- AI helpers ----

    @patch("apps.placements.views.ai_json", return_value={"company_name": "TCS", "package": "7 LPA"})
    def test_ai_extract_fills_fields_for_writers(self, mock_ai):
        response = self._client(self.cr).post(
            "/api/drives/ai_extract/",
            {"text": "TCS hiring! Software Engineer, Hyderabad, 7 LPA. Last date 15 Aug."},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["company_name"], "TCS")
        mock_ai.assert_called_once()

    def test_ai_extract_rejects_short_text(self):
        response = self._client(self.faculty).post(
            "/api/drives/ai_extract/", {"text": "hi"}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_ai_extract_rejects_oversized_paste(self):
        response = self._client(self.faculty).post(
            "/api/drives/ai_extract/", {"text": "x" * 10_001}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_ai_extract_needs_write_role(self):
        response = self._client(self.student).post(
            "/api/drives/ai_extract/",
            {"text": "Some long text about a company drive for the test."},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    @patch("apps.placements.views.ai_json", side_effect=AiError("key missing"))
    def test_ai_extract_handles_ai_error(self, mock_ai):
        response = self._client(self.admin).post(
            "/api/drives/ai_extract/",
            {"text": "Some long text about a company drive for the test."},
            format="json",
        )
        self.assertEqual(response.status_code, 502)
        self.assertIn("key missing", response.data["detail"])

    def test_parse_eligibility_xlsx(self):
        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.append(["Roll Number", "Eligibility"])
        ws.append(["21CSE01", "B.Tech CSE"])
        ws.append(["21cse02", "B.Tech CSE"])  # lowercase - should be normalized
        buffer = io.BytesIO()
        wb.save(buffer)
        file = SimpleUploadedFile("eligibility.xlsx", buffer.getvalue())
        response = self._client(self.faculty).post(
            "/api/drives/parse_eligibility/", {"file": file}, format="multipart"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)
        self.assertIn("21CSE01", response.data["roll_numbers"])
        self.assertIn("21CSE02", response.data["roll_numbers"])
        self.assertIn("B.Tech CSE", response.data["eligibility"])

    def test_parse_eligibility_csv_without_header(self):
        csv_bytes = b"21CSE10,21CSE11\n21CSE12,21CSE13\n"
        file = SimpleUploadedFile("rolls.csv", csv_bytes)
        response = self._client(self.admin).post(
            "/api/drives/parse_eligibility/", {"file": file}, format="multipart"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 4)

    def test_parse_eligibility_rejects_unknown_format(self):
        file = SimpleUploadedFile("notes.txt", b"hello")
        response = self._client(self.admin).post(
            "/api/drives/parse_eligibility/", {"file": file}, format="multipart"
        )
        self.assertEqual(response.status_code, 400)

    def test_parse_eligibility_rejects_files_over_5mb(self):
        file = SimpleUploadedFile("huge.xlsx", b"x" * (5 * 1024 * 1024 + 1))
        response = self._client(self.admin).post(
            "/api/drives/parse_eligibility/", {"file": file}, format="multipart"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("too large", response.data["detail"])

    @patch("apps.placements.views.ai_plain_text", return_value="Yes, you qualify for TCS.")
    def test_ai_chat_allowed_for_students(self, mock_ai):
        response = self._client(self.student).post(
            "/api/drives/ai_chat/", {"question": "Am I eligible for TCS?"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["answer"], "Yes, you qualify for TCS.")

    def test_ai_chat_rejects_empty_question(self):
        response = self._client(self.student).post(
            "/api/drives/ai_chat/", {"question": ""}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_ai_chat_rejects_oversized_question(self):
        response = self._client(self.student).post(
            "/api/drives/ai_chat/", {"question": "x" * 1_001}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    @patch("apps.placements.views.ai_plain_text", return_value="It is a 2-round process.")
    def test_ai_ask_uses_llm_for_complex_questions(self, mock_ai):
        drive = Drive.objects.create(
            company_name="TCS", last_date_to_apply=self.today + timedelta(days=5),
            posted_by=self.admin,
        )
        response = self._client(self.student).post(
            f"/api/drives/{drive.id}/ai_ask/",
            {"question": "What is the selection process?"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["answer"], "It is a 2-round process.")
        # The drive's real details travel as RAG grounding documents - the
        # model may only answer from them.
        self.assertIn("TCS", mock_ai.call_args.kwargs["documents"][0])
        self.assertIn("21CSE01", mock_ai.call_args.args[0])  # student profile

    def test_ai_ask_answers_fact_questions_from_database(self):
        drive = Drive.objects.create(
            company_name="TCS", package="6 LPA",
            last_date_to_apply=self.today + timedelta(days=5),
            eligible_roll_numbers="21CSE01", posted_by=self.admin,
        )
        with patch("apps.placements.views.ai_plain_text") as mock_ai:
            package = self._client(self.student).post(
                f"/api/drives/{drive.id}/ai_ask/",
                {"question": "What is the package?"}, format="json",
            )
            deadline = self._client(self.student).post(
                f"/api/drives/{drive.id}/ai_ask/",
                {"question": "When is the last date?"}, format="json",
            )
            link = self._client(self.student).post(
                f"/api/drives/{drive.id}/ai_ask/",
                {"question": "Where do I apply?"}, format="json",
            )
            eligibility = self._client(self.student).post(
                f"/api/drives/{drive.id}/ai_ask/",
                {"question": "Am I eligible for this drive?"}, format="json",
            )
        self.assertEqual(package.status_code, 200)
        self.assertIn("6 LPA", package.data["answer"])
        self.assertIn(str(drive.last_date_to_apply), deadline.data["answer"])
        self.assertIn("apply", link.data["answer"].lower())
        self.assertIn("21CSE01", eligibility.data["answer"])
        # Every answer came straight from the database - no LLM call at all.
        mock_ai.assert_not_called()

    def test_ai_ask_caches_repeated_questions(self):
        drive = Drive.objects.create(
            company_name="TCS", package="6 LPA",
            last_date_to_apply=self.today + timedelta(days=5), posted_by=self.admin,
        )

        def fake_ai(prompt, text, max_tokens=800, usage_callback=None, **kwargs):
            if usage_callback:
                usage_callback(10, 5)
            return "Nemotron reply"

        with patch("apps.placements.views.ai_plain_text", side_effect=fake_ai) as mock_ai:
            first = self._client(self.student).post(
                f"/api/drives/{drive.id}/ai_ask/",
                {"question": "Summarise this drive."}, format="json",
            )
            second = self._client(self.student).post(
                f"/api/drives/{drive.id}/ai_ask/",
                {"question": "Summarise this drive."}, format="json",
            )
        self.assertEqual(first.data["answer"], "Nemotron reply")
        self.assertEqual(second.data["answer"], "Nemotron reply")
        # The identical second question hit the 5-minute cache.
        self.assertEqual(mock_ai.call_count, 1)

    def test_ai_chat_quick_answers_when_a_drive_is_named(self):
        Drive.objects.create(
            company_name="TCS", package="7 LPA",
            last_date_to_apply=self.today + timedelta(days=5), posted_by=self.admin,
        )
        with patch("apps.placements.views.ai_plain_text") as mock_ai:
            response = self._client(self.student).post(
                "/api/drives/ai_chat/",
                {"question": "What is the TCS package?"}, format="json",
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn("7 LPA", response.data["answer"])
        mock_ai.assert_not_called()

    def test_ai_ask_rejects_empty_question(self):
        drive = Drive.objects.create(
            company_name="TCS", last_date_to_apply=self.today + timedelta(days=5),
            posted_by=self.admin,
        )
        response = self._client(self.student).post(
            f"/api/drives/{drive.id}/ai_ask/", {"question": ""}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    # ---- AI credits / usage tracking ----

    def test_ai_usage_is_logged_per_call(self):
        def fake_ai(prompt, text, max_tokens=1024, usage_callback=None, **kwargs):
            if usage_callback:
                usage_callback(120, 40)
            return {"company_name": "TCS"}

        with patch("apps.placements.views.ai_json", side_effect=fake_ai):
            response = self._client(self.cr).post(
                "/api/drives/ai_extract/",
                {"text": "TCS hiring freshers, last date 15 Aug, eligibility CSE."},
                format="json",
            )
        self.assertEqual(response.status_code, 200)
        log = AiUsageLog.objects.get()
        self.assertEqual(log.action, AiUsageLog.Action.EXTRACT)
        self.assertEqual(log.user_id, self.cr.id)
        self.assertEqual(log.total_tokens, 160)

    def test_ai_usage_endpoint_is_admin_only(self):
        self.assertEqual(
            self._client(self.student).get("/api/drives/ai_usage/").status_code, 403
        )
        self.assertEqual(
            self._client(self.cr).get("/api/drives/ai_usage/").status_code, 403
        )

    def test_ai_usage_endpoint_returns_totals_and_per_user(self):
        AiUsageLog.objects.create(
            user=self.student, action=AiUsageLog.Action.CHAT,
            prompt_tokens=100, completion_tokens=50,
        )
        AiUsageLog.objects.create(
            user=self.student, action=AiUsageLog.Action.ASK,
            prompt_tokens=80, completion_tokens=20,
        )
        AiUsageLog.objects.create(
            user=self.student2, action=AiUsageLog.Action.CHAT,
            prompt_tokens=40, completion_tokens=10,
        )
        response = self._client(self.admin).get("/api/drives/ai_usage/")
        self.assertEqual(response.status_code, 200)
        data = response.data
        self.assertEqual(data["totals"]["calls"], 3)
        self.assertEqual(data["totals"]["used_tokens"], 300)
        by_user = {u["roll_number"]: u for u in data["per_user"]}
        self.assertEqual(by_user["21CSE01"]["total_tokens"], 250)
        self.assertEqual(by_user["21CSE02"]["total_tokens"], 50)

    def test_ai_budget_set_and_percent_used(self):
        AiUsageLog.objects.create(
            user=self.student, action=AiUsageLog.Action.CHAT,
            prompt_tokens=100, completion_tokens=50,
        )
        # Student can't set the budget.
        self.assertEqual(
            self._client(self.student).post(
                "/api/drives/ai_budget/", {"budget_tokens": 1000}, format="json"
            ).status_code,
            403,
        )
        response = self._client(self.admin).post(
            "/api/drives/ai_budget/", {"budget_tokens": 1000}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        data = self._client(self.admin).get("/api/drives/ai_usage/").data
        self.assertEqual(data["budget_tokens"], 1000)
        self.assertEqual(data["remaining_tokens"], 850)
        self.assertEqual(data["percent_used"], 15.0)

    def test_ai_usage_daily_breakdown_buckets_by_date(self):
        today = timezone.localdate()
        AiUsageLog.objects.create(
            user=self.student, action=AiUsageLog.Action.CHAT,
            prompt_tokens=100, completion_tokens=50,
        )
        old_log = AiUsageLog.objects.create(
            user=self.student2, action=AiUsageLog.Action.ASK,
            prompt_tokens=10, completion_tokens=5,
        )
        # auto_now_add ignores the value on create() - backdate via update().
        AiUsageLog.objects.filter(pk=old_log.pk).update(
            created_at=timezone.now() - timedelta(days=3)
        )

        data = self._client(self.admin).get("/api/drives/ai_usage/").data
        daily = data["daily"]
        self.assertEqual(len(daily), 30)
        # Today's bucket holds the chat call (100 + 50 tokens).
        self.assertEqual(daily[-1]["date"], today.isoformat())
        self.assertEqual(daily[-1]["calls"], 1)
        self.assertEqual(daily[-1]["tokens"], 150)
        # The backdated ask call lands in its own day bucket.
        three_days_ago = daily[26]  # 30-day series: index 26 == today - 3
        self.assertEqual(
            three_days_ago["date"], (today - timedelta(days=3)).isoformat()
        )
        self.assertEqual(three_days_ago["calls"], 1)
        self.assertEqual(three_days_ago["tokens"], 15)

    def test_my_ai_usage_shows_only_your_own_usage(self):
        AiUsageLog.objects.create(
            user=self.student, action=AiUsageLog.Action.CHAT,
            prompt_tokens=100, completion_tokens=50,
        )
        AiUsageLog.objects.create(
            user=self.student2, action=AiUsageLog.Action.ASK,
            prompt_tokens=9000, completion_tokens=1000,
        )
        mine = self._client(self.student).get("/api/drives/my_ai_usage/")
        self.assertEqual(mine.status_code, 200)
        self.assertEqual(mine.data["calls"], 1)
        self.assertEqual(mine.data["used_tokens"], 150)
        self.assertEqual(mine.data["credits"], 1)  # ceil(150 / 1000)
        self.assertEqual(len(mine.data["recent"]), 1)
        self.assertEqual(mine.data["recent"][0]["action_label"], "AI Chat")

    def test_ai_uses_rag_model_and_documents_when_rag_key_set(self):
        import os

        from apps.placements.ai import ai_json, RAG_MODEL

        fake = _FakeOpenAI(content='{"ok": true}')
        old_key = os.environ.get("NVIDIA_RAG_API_KEY")
        os.environ["NVIDIA_RAG_API_KEY"] = "nvapi-rag-test"
        try:
            with (
                patch("apps.placements.ai.OpenAI", side_effect=lambda **kw: fake),
                patch("apps.placements.ai.get_api_key", return_value="gen-key"),
            ):
                result = ai_json(
                    "system", "user text", documents=["Drive: TCS, 6 LPA"]
                )
        finally:
            if old_key is None:
                os.environ.pop("NVIDIA_RAG_API_KEY", None)
            else:
                os.environ["NVIDIA_RAG_API_KEY"] = old_key
        self.assertEqual(result, {"ok": True})
        # The RAG NIM is used with the documents as grounding, and the RAG key
        # is what authenticates the client.
        self.assertEqual(fake.calls[0]["model"], RAG_MODEL)
        self.assertEqual(
            fake.calls[0]["extra_body"]["documents"],
            [{"content": "Drive: TCS, 6 LPA"}],
        )

    def test_ai_rag_falls_back_to_context_injection_when_rag_fails(self):
        import os

        from openai import BadRequestError

        from apps.placements.ai import DEFAULT_MODEL, RAG_MODEL, ai_json

        fake = _FakeOpenAI(content='{"ok": true}')
        # First call (the RAG NIM) rejects the documents parameter - the
        # client must fall back to prompt injection with the 30B model.
        fake._errors = [
            BadRequestError(
                "documents not supported",
                response=SimpleNamespace(status_code=400, headers={}, request=object()),
                body=None,
            )
        ]
        old_key = os.environ.get("NVIDIA_RAG_API_KEY")
        os.environ["NVIDIA_RAG_API_KEY"] = "nvapi-rag-test"
        try:
            with (
                patch("apps.placements.ai.OpenAI", side_effect=lambda **kw: fake),
                patch("apps.placements.ai.get_api_key", return_value="gen-key"),
            ):
                result = ai_json(
                    "system", "user text", documents=["Drive: TCS, 6 LPA"]
                )
        finally:
            if old_key is None:
                os.environ.pop("NVIDIA_RAG_API_KEY", None)
            else:
                os.environ["NVIDIA_RAG_API_KEY"] = old_key
        self.assertEqual(result, {"ok": True})
        self.assertEqual(fake.calls[0]["model"], RAG_MODEL)  # RAG attempt first
        self.assertEqual(fake.calls[1]["model"], DEFAULT_MODEL)  # fallback
        # The fallback embeds the document into the system prompt.
        self.assertIn("Drive: TCS, 6 LPA", fake.calls[1]["messages"][0]["content"])
        # And no grounding documents leak into the fallback body.
        self.assertNotIn("documents", fake.calls[1].get("extra_body", {}))

    def test_ai_uses_nemotron_30b_a3b_by_default(self):
        from apps.placements.ai import ai_json

        fake = _FakeOpenAI(content='{"ok": true}')
        with (
            patch("apps.placements.ai.OpenAI", side_effect=lambda **kw: fake),
            patch("apps.placements.ai.get_api_key", return_value="test-key"),
        ):
            result = ai_json("system", "user text")
        self.assertEqual(result, {"ok": True})
        self.assertEqual(fake.calls[0]["model"], "nvidia/nemotron-3-nano-30b-a3b")

    def test_ai_429_is_retried_then_succeeds(self):
        from apps.placements.ai import ai_json

        fake = _FakeOpenAI(content='{"ok": true}', errors=[_FakeRateLimit()])
        with (
            patch("apps.placements.ai.OpenAI", side_effect=lambda **kw: fake),
            patch("apps.placements.ai.get_api_key", return_value="test-key"),
            patch("apps.placements.ai._429_BACKOFF_SECONDS", 0.01),
        ):
            result = ai_json("system", "user text", usage_callback=lambda p, c: None)
        self.assertEqual(result, {"ok": True})
        self.assertEqual(len(fake.calls), 2)  # one retry after the 429

    def test_ai_json_strips_markdown_fences_from_model_output(self):
        from apps.placements.ai import ai_json

        fake = _FakeOpenAI(content='```json\n{"company": "TCS"}\n```')
        with (
            patch("apps.placements.ai.OpenAI", side_effect=lambda **kw: fake),
            patch("apps.placements.ai.get_api_key", return_value="test-key"),
        ):
            self.assertEqual(ai_json("s", "u"), {"company": "TCS"})

    def test_missing_api_key_raises_friendly_error(self):
        import os

        from apps.placements.ai import AiError, get_api_key

        old = os.environ.pop("NVIDIA_API_KEY", None)
        try:
            with self.assertRaises(AiError) as ctx:
                get_api_key()
            self.assertIn("NVIDIA_API_KEY", str(ctx.exception))
        finally:
            if old is not None:
                os.environ["NVIDIA_API_KEY"] = old

    def test_ai_extract_returns_structured_and_legacy_fields(self):
        structured = {
            "company_name": "TCS", "job_role": "Software Engineer",
            "job_type": "Full-time", "work_mode": "Hybrid",
            "location": "Hyderabad", "package": "6 LPA",
            "eligible_branches": ["CSE", "IT"], "minimum_cgpa": "6.5",
            "maximum_backlogs": "0", "passing_year": ["2025", "2026"],
            "eligible_roll_numbers": "21CSE01, 21CSE02",
            "selection_process": "Aptitude -> Technical -> HR",
            "application_deadline": "2026-08-15",
            "apply_link": "https://apply.example.com/tcs",
            "job_description": "Hiring freshers for core engineering.",
            "required_skills": ["Python", "SQL"],
            "important_instructions": "Carry two printouts.",
            "company_description": "A global IT services firm.",
        }
        with patch("apps.placements.views.ai_json", return_value=structured):
            response = self._client(self.admin).post(
                "/api/drives/ai_extract/",
                {"text": "TCS hiring! Software Engineer, Hyderabad, 6 LPA. Last date 15 Aug."},
                format="json",
            )
        self.assertEqual(response.status_code, 200)
        data = response.data
        # The rich structured keys are preserved...
        self.assertEqual(data["job_role"], "Software Engineer")
        self.assertEqual(data["selection_process"], "Aptitude -> Technical -> HR")
        # ...and mapped onto the form's legacy keys for auto-fill.
        self.assertEqual(data["role"], "Software Engineer")
        self.assertEqual(data["last_date_to_apply"], "2026-08-15")
        self.assertEqual(data["drive_link"], "https://apply.example.com/tcs")
        self.assertIn("Aptitude", data["description"])
        self.assertIn("Eligible branches: CSE, IT", data["eligibility"])
        self.assertIn("Minimum CGPA: 6.5", data["eligibility"])

    def test_drive_my_match_comes_from_analyzed_resume(self):
        from apps.accounts.models import Resume

        drive = Drive.objects.create(
            company_name="TCS", last_date_to_apply=self.today + timedelta(days=5),
            posted_by=self.admin,
        )
        resume = Resume.objects.create(
            student=self.student, file_name="r.pdf", file_size=10,
            cloudinary_url="https://res.cloudinary.com/x/r.pdf", public_id="resumes/x",
        )
        resume.ai_status = Resume.AiStatus.COMPLETE
        resume.ai_match = {
            str(drive.id): {"score": 82, "reason": "Java + SQL fit the role", "company_name": "TCS"}
        }
        resume.save()

        data = self._client(self.student).get(f"/api/drives/{drive.id}/").data
        self.assertEqual(data["my_match"]["score"], 82)
        self.assertIn("Java", data["my_match"]["reason"])
        # Non-students never see a personal match.
        self.assertIsNone(self._client(self.admin).get(f"/api/drives/{drive.id}/").data["my_match"])

    @patch("apps.placements.views.ai_plain_text", return_value="It closed last week.")
    def test_ai_ask_works_for_expired_drives(self, mock_ai):
        drive = Drive.objects.create(
            company_name="OldCo", last_date_to_apply=self.today - timedelta(days=2),
            posted_by=self.admin,
        )
        response = self._client(self.student).post(
            f"/api/drives/{drive.id}/ai_ask/",
            {"question": "Is this drive still open?"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["answer"], "It closed last week.")

    # ---- Job / Internship type ----

    def test_drive_job_type_is_saved_and_serialized(self):
        response = self._client(self.admin).post(
            "/api/drives/",
            self._payload(job_type="INTERNSHIP"),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["job_type"], "INTERNSHIP")
        drive = Drive.objects.get(company_name="TCS")
        self.assertEqual(drive.job_type, Drive.JobType.INTERNSHIP)

    def test_ai_extract_maps_job_type_to_choices(self):
        with patch(
            "apps.placements.views.ai_json",
            return_value={"company_name": "TCS", "job_type": "Internship", "job_role": "SE"},
        ):
            response = self._client(self.admin).post(
                "/api/drives/ai_extract/",
                {"text": "TCS is hiring interns, last date 15 Aug."},
                format="json",
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["job_type"], "INTERNSHIP")

    def test_ai_extract_blank_job_type_when_not_mentioned(self):
        with patch(
            "apps.placements.views.ai_json",
            return_value={"company_name": "TCS", "job_type": None},
        ):
            response = self._client(self.admin).post(
                "/api/drives/ai_extract/",
                {"text": "TCS hiring freshers, last date 15 Aug."},
                format="json",
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["job_type"], "")

    # ---- Saved per-drive AI chat ----

    @patch("apps.placements.views.ai_plain_text", return_value="It is a 2-round process.")
    def test_ai_ask_saves_chat_history(self, mock_ai):
        drive = Drive.objects.create(
            company_name="TCS", last_date_to_apply=self.today + timedelta(days=5),
            posted_by=self.admin,
        )
        # A unique question keeps the module-level AI answer cache from being
        # polluted for other tests.
        response = self._client(self.student).post(
            f"/api/drives/{drive.id}/ai_ask/",
            {"question": "Which interview rounds does TCS conduct?"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        messages = DriveChatMessage.objects.filter(drive=drive, user=self.student)
        self.assertEqual(messages.count(), 2)
        self.assertEqual(list(messages.values_list("role", flat=True)), ["user", "assistant"])
        self.assertEqual(messages[0].content, "Which interview rounds does TCS conduct?")
        self.assertEqual(messages[1].content, "It is a 2-round process.")

    @patch("apps.placements.views.ai_plain_text")
    def test_ai_ask_saves_quick_answers_too(self, mock_ai):
        drive = Drive.objects.create(
            company_name="TCS", package="6 LPA",
            last_date_to_apply=self.today + timedelta(days=5), posted_by=self.admin,
        )
        response = self._client(self.student).post(
            f"/api/drives/{drive.id}/ai_ask/",
            {"question": "What is the package?"}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        # Quick DB answers are saved too - no LLM call, history still kept.
        mock_ai.assert_not_called()
        self.assertEqual(
            DriveChatMessage.objects.filter(drive=drive, user=self.student).count(), 2
        )

    @patch("apps.placements.views.ai_plain_text", return_value="Yes, you qualify.")
    def test_chat_history_is_scoped_per_student(self, mock_ai):
        drive = Drive.objects.create(
            company_name="TCS", last_date_to_apply=self.today + timedelta(days=5),
            posted_by=self.admin,
        )
        self._client(self.student).post(
            f"/api/drives/{drive.id}/ai_ask/",
            {"question": "Am I eligible?"}, format="json",
        )
        # The asking student sees their own saved conversation.
        mine = self._client(self.student).get(f"/api/drives/{drive.id}/chat_history/")
        self.assertEqual(mine.status_code, 200)
        self.assertEqual(len(mine.data["messages"]), 2)
        self.assertEqual(mine.data["messages"][0]["role"], "user")
        # Another student never sees the first student's chat.
        other = self._client(self.student2).get(f"/api/drives/{drive.id}/chat_history/")
        self.assertEqual(other.data["messages"], [])

    @patch("apps.placements.views.ai_plain_text", return_value="Yes, you qualify.")
    def test_faculty_sees_all_student_chat_for_the_drive(self, mock_ai):
        drive = Drive.objects.create(
            company_name="TCS", last_date_to_apply=self.today + timedelta(days=5),
            posted_by=self.admin,
        )
        self._client(self.student).post(
            f"/api/drives/{drive.id}/ai_ask/",
            {"question": "Am I eligible?"}, format="json",
        )
        self._client(self.student2).post(
            f"/api/drives/{drive.id}/ai_ask/",
            {"question": "Is it remote?"}, format="json",
        )
        data = self._client(self.admin).get(f"/api/drives/{drive.id}/chat_history/")
        self.assertEqual(data.status_code, 200)
        self.assertEqual(len(data.data["messages"]), 4)

    @patch("apps.placements.views.ai_plain_text", return_value="It closed last week.")
    def test_chat_history_survives_drive_expiry(self, mock_ai):
        drive = Drive.objects.create(
            company_name="OldCo", last_date_to_apply=self.today - timedelta(days=2),
            posted_by=self.admin,
        )
        self._client(self.student).post(
            f"/api/drives/{drive.id}/ai_ask/",
            {"question": "Is it still open?"}, format="json",
        )
        # Even though the drive is EXPIRED, the saved chat is still readable.
        data = self._client(self.student).get(f"/api/drives/{drive.id}/chat_history/")
        self.assertEqual(len(data.data["messages"]), 2)
        self.assertIn("closed", data.data["messages"][1]["content"])

    def test_chat_history_requires_auth(self):
        drive = Drive.objects.create(
            company_name="TCS", last_date_to_apply=self.today + timedelta(days=5),
            posted_by=self.admin,
        )
        self.assertEqual(
            APIClient().get(f"/api/drives/{drive.id}/chat_history/").status_code, 401
        )


class _FakeRateLimit(RateLimitError):
    """A RateLimitError instance without the SDK's constructor requirements."""

    def __init__(self):
        pass


class _FakeOpenAI:
    """Minimal stand-in for openai.OpenAI so ai.py never touches the network.

    ``client.chat.completions.create(...)`` maps to ``.create(...)`` here and
    every call (model, extra_body, etc.) is recorded on ``calls``.
    """

    def __init__(self, content="", errors=(), usage=(10, 5)):
        self.responses = [
            SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
                usage=SimpleNamespace(
                    prompt_tokens=usage[0], completion_tokens=usage[1]
                ),
            )
        ]
        self._errors = list(errors)
        self.calls: list[dict] = []
        self.chat = _FakeChat(self)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._errors:
            raise self._errors.pop(0)
        return self.responses.pop(0)


class _FakeChat:
    """The ``chat`` attribute exposing ``.completions`` (an object with create)."""

    def __init__(self, parent):
        self.completions = parent
