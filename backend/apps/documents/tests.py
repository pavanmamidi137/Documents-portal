import urllib.error
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient, APIRequestFactory

from apps.accounts.models import User
from apps.college.models import Branch, Category, Section, Semester, Subject

from .models import Document, DocumentShareRequest
from .serializers import DocumentCreateSerializer
from .services import build_folder, validate_document


class FolderTests(TestCase):
    def test_build_folder_structure(self):
        branch = Branch.objects.create(name="Computer Science")
        section = Section.objects.create(branch=branch, name="A")
        semester = Semester.objects.create(name="3-1", order=5)
        category = Category.objects.create(name="Mid-1")
        subject = Subject.objects.create(name="DBMS", semester=semester)
        folder = build_folder(branch, section, semester, category, subject)
        self.assertEqual(
            folder,
            "documents/computer-science/a/3-1/mid-1/dbms",
        )


class DocumentValidationTests(TestCase):
    def test_rejects_unsupported_extension(self):
        fake = SimpleUploadedFile("notes.exe", b"MZ\x90", content_type="application/octet-stream")
        with self.assertRaises(Exception):
            validate_document(fake)

    def test_accepts_pdf(self):
        fake = SimpleUploadedFile("notes.pdf", b"%PDF-1.4 fake", content_type="application/pdf")
        validate_document(fake)  # should not raise

    def test_accepts_pptx(self):
        fake = SimpleUploadedFile(
            "slides.pptx", b"PK\x03\x04fakezip",
            content_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
        validate_document(fake)

    def test_accepts_docx(self):
        fake = SimpleUploadedFile(
            "report.docx", b"PK\x03\x04fakezip",
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        validate_document(fake)

    def test_accepts_old_binary_ppt(self):
        fake = SimpleUploadedFile(
            "deck.ppt", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1fake",
            content_type="application/vnd.ms-powerpoint",
        )
        validate_document(fake)

    def test_accepts_txt(self):
        fake = SimpleUploadedFile("notes.txt", b"plain text notes", content_type="text/plain")
        validate_document(fake)

    def test_rejects_renamed_html_pretending_to_be_pdf(self):
        fake = SimpleUploadedFile("evil.pdf", b"<html>nope</html>", content_type="application/pdf")
        with self.assertRaises(Exception):
            validate_document(fake)


class DocumentCreateSerializerTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )
        self.branch = Branch.objects.create(name="CSE")
        self.section = Section.objects.create(branch=self.branch, name="A")
        self.sem1 = Semester.objects.create(name="1-1", order=1)
        self.sem2 = Semester.objects.create(name="1-2", order=2)
        self.category = Category.objects.create(name="Notes")
        self.subject_ok = Subject.objects.create(name="Python", semester=self.sem1)
        self.subject_other = Subject.objects.create(name="Java", semester=self.sem2)

    def _serializer(self, user, **data):
        payload = {
            "title": "Unit 1 Notes",
            "file": SimpleUploadedFile("notes.pdf", b"%PDF fake", content_type="application/pdf"),
            "branch": self.branch.id,
            "section": self.section.id,
            "semester": self.sem1.id,
            "category": self.category.id,
            "subject": self.subject_ok.id,
        }
        payload.update(data)
        request = self.factory.post("/api/documents/", payload, format="multipart")
        request.user = user
        return DocumentCreateSerializer(data=payload, context={"request": request})

    def test_valid_upload_payload(self):
        serializer = self._serializer(self.admin)
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_subject_semester_mismatch_rejected(self):
        serializer = self._serializer(self.admin, subject=self.subject_other.id)
        self.assertFalse(serializer.is_valid())
        self.assertIn("subject", serializer.errors)

    def test_cr_limited_to_own_section(self):
        cr = User.objects.create_user(
            roll_number="cr1", password="x", full_name="CR One",
            branch=self.branch, section=self.section, role=User.Role.CR,
        )
        other_section = Section.objects.create(branch=self.branch, name="B")
        serializer = self._serializer(cr, section=other_section.id)
        self.assertFalse(serializer.is_valid())


@patch("apps.documents.services.cloudinary.uploader.upload")
@patch("apps.documents.services.cloudinary.api.delete_resources")
class DocumentApiTests(TestCase):
    """End-to-end upload/delete lifecycle with Cloudinary mocked out."""

    def setUp(self):
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )
        self.branch = Branch.objects.create(name="CSE")
        self.section = Section.objects.create(branch=self.branch, name="A")
        self.other_section = Section.objects.create(branch=self.branch, name="B")
        self.semester = Semester.objects.create(name="3-1", order=5)
        self.category = Category.objects.create(name="Notes")
        self.subject = Subject.objects.create(
            name="DBMS", code="CS303", semester=self.semester, branch=self.branch
        )
        self.cr = User.objects.create_user(
            roll_number="cr1", password="x", full_name="CR One",
            branch=self.branch, section=self.section, role=User.Role.CR,
        )

    def _pdf(self):
        return SimpleUploadedFile(
            "dbms-notes.pdf", b"%PDF-1.4 fake pdf content", content_type="application/pdf"
        )

    def _upload(self, client, section, user):
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(user)}")
        return client.post(
            "/api/documents/",
            {
                "title": "DBMS Unit 1",
                "file": self._pdf(),
                "branch": self.branch.id,
                "section": section.id,
                "semester": self.semester.id,
                "category": self.category.id,
                "subject": self.subject.id,
            },
            format="multipart",
        )

    def _token(self, user):
        from rest_framework_simplejwt.tokens import AccessToken

        return str(AccessToken.for_user(user))

    def test_admin_upload_and_delete_lifecycle(self, mock_delete, mock_upload):
        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/x/raw/upload/v1/dbms.pdf",
            "public_id": "documents/cse/a/3-1/notes/dbms/abc123",
        }
        client = APIClient()
        response = self._upload(client, self.section, self.admin)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Document.objects.count(), 1)

        doc = Document.objects.first()
        self.assertEqual(doc.title, "DBMS Unit 1")
        self.assertEqual(doc.public_id, "documents/cse/a/3-1/notes/dbms/abc123")
        # Folder passed to Cloudinary matches the required structure.
        folder = mock_upload.call_args.kwargs["folder"]
        self.assertEqual(folder, "documents/cse/a/3-1/notes/dbms")
        # download_url forces attachment and is signed (restricted delivery safe)
        self.assertIn("fl_attachment", doc.download_url)
        # The SDK signs with either the short (s--...) or long (sig=...) format.
        self.assertTrue("s--" in doc.download_url or "sig=" in doc.download_url, doc.download_url)
        # The API exposes a signed cloudinary_url so previews work too.
        self.assertTrue(
            "s--" in response.data["cloudinary_url"] or "sig=" in response.data["cloudinary_url"],
            response.data["cloudinary_url"],
        )

        # Deleting removes the Cloudinary file, then the record.
        delete_resp = client.delete(f"/api/documents/{doc.id}/")
        self.assertEqual(delete_resp.status_code, 204)
        mock_delete.assert_called_once_with([doc.public_id], resource_type="raw")
        self.assertEqual(Document.objects.count(), 0)

    def test_cr_upload_to_own_section_succeeds(self, mock_delete, mock_upload):
        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/x/raw/upload/v1/f.pdf",
            "public_id": "documents/cse/a/3-1/notes/dbms/cr123",
        }
        client = APIClient()
        response = self._upload(client, self.section, self.cr)
        self.assertEqual(response.status_code, 201, response.data)

    def test_cr_upload_to_other_section_rejected_before_cloudinary(self, mock_delete, mock_upload):
        client = APIClient()
        response = self._upload(client, self.other_section, self.cr)
        self.assertEqual(response.status_code, 400)
        mock_upload.assert_not_called()

    def test_non_pdf_rejected_by_magic_bytes(self, mock_delete, mock_upload):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(self.admin)}")
        response = client.post(
            "/api/documents/",
            {
                "title": "Evil File",
                "file": SimpleUploadedFile(
                    "evil.pdf", b"<html>not a pdf</html>", content_type="application/pdf"
                ),
                "branch": self.branch.id,
                "section": self.section.id,
                "semester": self.semester.id,
                "category": self.category.id,
                "subject": self.subject.id,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("not a valid PDF", str(response.data))
        mock_upload.assert_not_called()

    def test_pptx_upload_succeeds(self, mock_delete, mock_upload):
        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/x/raw/upload/v1/slides.pptx",
            "public_id": "documents/cse/a/3-1/notes/dbms/slides123",
        }
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(self.admin)}")
        response = client.post(
            "/api/documents/",
            {
                "title": "Unit 1 Slides",
                "file": SimpleUploadedFile(
                    "slides.pptx", b"PK\x03\x04fakezip",
                    content_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                ),
                "branch": self.branch.id,
                "section": self.section.id,
                "semester": self.semester.id,
                "category": self.category.id,
                "subject": self.subject.id,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Document.objects.first().file_name, "slides.pptx")

    def test_unsupported_format_rejected(self, mock_delete, mock_upload):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(self.admin)}")
        response = client.post(
            "/api/documents/",
            {
                "title": "Zipped Archive",
                "file": SimpleUploadedFile(
                    "archive.zip", b"PK\x03\x04fakezip",
                    content_type="application/zip",
                ),
                "branch": self.branch.id,
                "section": self.section.id,
                "semester": self.semester.id,
                "category": self.category.id,
                "subject": self.subject.id,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Only PDF, PPT", str(response.data))
        mock_upload.assert_not_called()

    def test_admin_upload_to_multiple_sections(self, mock_delete, mock_upload):
        """One upload + sections list creates one row per section."""
        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/x/raw/upload/v1/multi.pdf",
            "public_id": "documents/cse/a/3-1/notes/dbms/multi123",
        }
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(self.admin)}")
        response = client.post(
            "/api/documents/",
            {
                "title": "Shared Notes",
                "file": SimpleUploadedFile("notes.pdf", b"%PDF-1.4 fake", content_type="application/pdf"),
                "branch": self.branch.id,
                "sections": [self.section.id, self.other_section.id],
                "semester": self.semester.id,
                "category": self.category.id,
                "subject": self.subject.id,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Document.objects.count(), 2)
        self.assertEqual(Document.objects.filter(public_id="documents/cse/a/3-1/notes/dbms/multi123").count(), 2)
        mock_upload.assert_called_once()

    def test_cr_upload_sections_limited_to_own_section(self, mock_delete, mock_upload):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(self.cr)}")
        response = client.post(
            "/api/documents/",
            {
                "title": "CR Notes",
                "file": SimpleUploadedFile("notes.pdf", b"%PDF-1.4 fake", content_type="application/pdf"),
                "branch": self.branch.id,
                "sections": [self.section.id, self.other_section.id],
                "semester": self.semester.id,
                "category": self.category.id,
                "subject": self.subject.id,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 400, response.data)
        mock_upload.assert_not_called()

    def test_cr_upload_creates_share_requests(self, mock_delete, mock_upload):
        """A CR upload with share_with_sections notifies the other section's CR."""
        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/x/raw/upload/v1/sr.pdf",
            "public_id": "documents/cse/a/3-1/notes/dbms/sr123",
        }
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(self.cr)}")
        response = client.post(
            "/api/documents/",
            {
                "title": "CR Shared Notes",
                "file": SimpleUploadedFile("notes.pdf", b"%PDF-1.4 fake", content_type="application/pdf"),
                "branch": self.branch.id,
                "section": self.section.id,
                "semester": self.semester.id,
                "category": self.category.id,
                "subject": self.subject.id,
                "share_with_sections": [self.other_section.id],
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(DocumentShareRequest.objects.count(), 1)
        req = DocumentShareRequest.objects.first()
        self.assertEqual(req.to_section_id, self.other_section.id)
        self.assertEqual(req.status, "PENDING")
        self.assertIn("share_requests", response.data)
        mock_upload.assert_called_once()


@patch("apps.documents.services.cloudinary.api.delete_resources")
class DocumentZipTests(TestCase):
    """ZIP export of the filtered document list (Cloudinary fetch mocked)."""

    def setUp(self):
        import io
        import zipfile

        self.zipfile, self.io = zipfile, io
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )
        self.branch = Branch.objects.create(name="CSE")
        self.section_a = Section.objects.create(branch=self.branch, name="A")
        self.section_b = Section.objects.create(branch=self.branch, name="B")
        self.semester = Semester.objects.create(name="3-1", order=5)
        self.category = Category.objects.create(name="Notes")
        self.subject = Subject.objects.create(
            name="DBMS", code="CS303", semester=self.semester, branch=self.branch
        )
        self.subject_other = Subject.objects.create(
            name="Python", code="CS101", semester=self.semester, branch=self.branch
        )
        self.doc_a = Document.objects.create(
            title="DBMS Unit 1", description="",
            file_name="dbms.pdf", file_size=1024,
            cloudinary_url="https://x.example/dbms.pdf",
            public_id="documents/cse/a/3-1/notes/dbms/dbms123",
            branch=self.branch, section=self.section_a,
            semester=self.semester, category=self.category,
            subject=self.subject, uploaded_by=self.admin,
        )
        self.doc_b = Document.objects.create(
            title="Python Unit 1", description="",
            file_name="python.pdf", file_size=1024,
            cloudinary_url="https://x.example/python.pdf",
            public_id="documents/cse/b/3-1/notes/dbms/python123",
            branch=self.branch, section=self.section_b,
            semester=self.semester, category=self.category,
            subject=self.subject_other, uploaded_by=self.admin,
        )

    def _client(self):
        from rest_framework_simplejwt.tokens import AccessToken

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.admin)}")
        return client

    def _names(self, response) -> list[str]:
        with self.zipfile.ZipFile(self.io.BytesIO(response.content)) as zf:
            return zf.namelist()

    def test_download_zip_bundles_filtered_documents(self, mock_delete):
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = b"%PDF-1.4 data"
            response = self._client().get("/api/documents/download_zip/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/zip")
        self.assertEqual(sorted(self._names(response)), ["dbms.pdf", "python.pdf"])

    def test_download_zip_respects_subject_filter(self, mock_delete):
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = b"%PDF-1.4 data"
            response = self._client().get(
                "/api/documents/download_zip/?subject=%d" % self.subject.id
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._names(response), ["dbms.pdf"])

    def test_download_zip_surfaces_cloudinary_block(self, mock_delete):
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.side_effect = urllib.error.HTTPError(
                "https://x", 401, "Unauthorized", hdrs=None, fp=None
            )
            response = self._client().get("/api/documents/download_zip/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Cloudinary", str(response.data))


class DocumentCheckFilesTests(TestCase):
    """Files deleted directly in Cloudinary are detected and hidden instantly."""

    def setUp(self):
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )
        self.branch = Branch.objects.create(name="CSE")
        self.section = Section.objects.create(branch=self.branch, name="A")
        self.semester = Semester.objects.create(name="3-1", order=5)
        self.category = Category.objects.create(name="Notes")
        self.subject = Subject.objects.create(
            name="DBMS", code="CS303", semester=self.semester, branch=self.branch
        )
        self.doc = Document.objects.create(
            title="DBMS Unit 1", description="",
            file_name="dbms.pdf", file_size=1024,
            cloudinary_url="https://x.example/dbms.pdf",
            public_id="documents/cse/a/3-1/notes/dbms/dbms123",
            branch=self.branch, section=self.section,
            semester=self.semester, category=self.category,
            subject=self.subject, uploaded_by=self.admin,
        )

    def _client(self):
        from rest_framework_simplejwt.tokens import AccessToken

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.admin)}")
        return client

    def test_check_files_flags_deleted_and_returns_id(self):
        with patch("apps.documents.services.cloudinary_file_exists") as mock_exists:
            mock_exists.return_value = False
            response = self._client().get("/api/documents/check-files/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["missing_ids"], [self.doc.id])
        self.doc.refresh_from_db()
        self.assertTrue(self.doc.is_missing)

    def test_check_files_keeps_existing_files(self):
        with patch("apps.documents.services.cloudinary_file_exists") as mock_exists:
            mock_exists.return_value = True
            response = self._client().get("/api/documents/check-files/")
        self.assertEqual(response.data["missing_ids"], [])
        self.doc.refresh_from_db()
        self.assertFalse(self.doc.is_missing)

    def test_check_files_unknown_result_leaves_flag_alone(self):
        with patch("apps.documents.services.cloudinary_file_exists") as mock_exists:
            mock_exists.return_value = None  # auth/network failure
            response = self._client().get("/api/documents/check-files/")
        self.assertEqual(response.data["missing_ids"], [])
        self.doc.refresh_from_db()
        self.assertFalse(self.doc.is_missing)

    def test_missing_documents_hidden_from_list(self):
        self.doc.is_missing = True
        self.doc.save()
        response = self._client().get("/api/documents/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 0)

    def test_missing_document_download_is_404(self):
        self.doc.is_missing = True
        self.doc.save()
        response = self._client().post(f"/api/documents/{self.doc.id}/download/")
        self.assertEqual(response.status_code, 404)

    def test_check_files_revives_restored_file(self):
        """A file restored in Cloudinary reappears with a restored marker."""
        from datetime import timedelta

        from django.utils import timezone

        self.doc.is_missing = True
        self.doc.file_checked_at = timezone.now() - timedelta(days=1)
        self.doc.save()
        with patch("apps.documents.services.cloudinary_file_exists") as mock_exists:
            mock_exists.return_value = True
            response = self._client().get("/api/documents/check-files/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["restored_ids"], [self.doc.id])
        self.doc.refresh_from_db()
        self.assertFalse(self.doc.is_missing)
        self.assertIsNotNone(self.doc.restored_at)
        # The document is visible in the list again.
        listed = self._client().get("/api/documents/")
        self.assertEqual(len(listed.data["results"]), 1)

    def test_restored_badge_expires_after_three_days(self):
        from datetime import timedelta

        from django.utils import timezone

        self.doc.restored_at = timezone.now() - timedelta(days=4)
        self.doc.file_checked_at = timezone.now() - timedelta(days=1)
        self.doc.save()
        with patch("apps.documents.services.cloudinary_file_exists") as mock_exists:
            mock_exists.return_value = True
            response = self._client().get("/api/documents/check-files/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["restored_ids"], [])
        self.doc.refresh_from_db()
        self.assertIsNone(self.doc.restored_at)

    def test_restored_at_exposed_in_list(self):
        from datetime import timedelta

        from django.utils import timezone

        self.doc.restored_at = timezone.now() - timedelta(hours=1)
        self.doc.save()
        response = self._client().get("/api/documents/")
        self.assertEqual(len(response.data["results"]), 1)
        self.assertIsNotNone(response.data["results"][0]["restored_at"])


@patch("apps.documents.services.cloudinary.api.delete_resources")
class ShareForkTests(TestCase):
    """Multi-section sharing and CR fork behaviour (no Cloudinary upload needed)."""

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
            name="DBMS", code="CS303", semester=self.semester, branch=self.branch
        )
        self.cr_a = User.objects.create_user(
            roll_number="cra", password="x", full_name="CR A",
            branch=self.branch, section=self.section_a, role=User.Role.CR,
        )
        self.cr_b = User.objects.create_user(
            roll_number="crb", password="x", full_name="CR B",
            branch=self.branch, section=self.section_b, role=User.Role.CR,
        )
        self.student = User.objects.create_user(
            roll_number="st1", password="x", full_name="Student",
            branch=self.branch, section=self.section_b,
        )
        self.source = Document.objects.create(
            title="DBMS Unit 1", description="",
            file_name="notes.pdf", file_size=1024,
            cloudinary_url="https://res.cloudinary.com/x/raw/upload/v1/n.pdf",
            public_id="shared/pid-1",
            branch=self.branch, section=self.section_a,
            semester=self.semester, category=self.category,
            subject=self.subject, uploaded_by=self.cr_a,
        )

    def _client(self, user):
        from rest_framework_simplejwt.tokens import AccessToken

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
        return client

    def test_admin_shares_to_other_section(self, mock_delete):
        client = self._client(self.admin)
        response = client.post(
            f"/api/documents/{self.source.id}/share/",
            {"sections": [self.section_b.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 1)
        copy = Document.objects.filter(section_id=self.section_b.id, public_id="shared/pid-1").first()
        self.assertIsNotNone(copy)
        self.assertEqual(copy.forked_from_id, self.source.id)

    def test_admin_share_dedupes_existing_sections(self, mock_delete):
        client = self._client(self.admin)
        client.post(
            f"/api/documents/{self.source.id}/share/",
            {"sections": [self.section_b.id]},
            format="json",
        )
        response = client.post(
            f"/api/documents/{self.source.id}/share/",
            {"sections": [self.section_a.id, self.section_b.id]},
            format="json",
        )
        self.assertEqual(response.data["count"], 0)  # both already covered
        self.assertEqual(Document.objects.filter(public_id="shared/pid-1").count(), 2)

    def test_cr_cannot_share(self, mock_delete):
        client = self._client(self.cr_b)
        response = client.post(
            f"/api/documents/{self.source.id}/share/",
            {"sections": [self.section_b.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_cr_cannot_fork(self, mock_delete):
        """Forking is admin-only now - CRs use share requests instead."""
        client = self._client(self.cr_b)
        response = client.post(f"/api/documents/{self.source.id}/fork/")
        self.assertEqual(response.status_code, 403)

    def test_admin_forks_into_section(self, mock_delete):
        client = self._client(self.admin)
        response = client.post(
            f"/api/documents/{self.source.id}/fork/",
            {"section": self.section_b.id},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        forked = Document.objects.get(section_id=self.section_b.id, public_id="shared/pid-1")
        self.assertEqual(forked.forked_from_id, self.source.id)
        self.assertEqual(forked.uploaded_by_id, self.admin.id)

    def test_admin_cannot_fork_duplicate(self, mock_delete):
        client = self._client(self.admin)
        client.post(
            f"/api/documents/{self.source.id}/fork/",
            {"section": self.section_b.id},
            format="json",
        )
        response = client.post(
            f"/api/documents/{self.source.id}/fork/",
            {"section": self.section_b.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_forkable_lists_documents_for_admin(self, mock_delete):
        client = self._client(self.admin)
        response = client.get("/api/documents/forkable/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["id"], self.source.id)

    def test_student_cannot_fork(self, mock_delete):
        client = self._client(self.student)
        response = client.post(f"/api/documents/{self.source.id}/fork/")
        self.assertEqual(response.status_code, 403)

    def test_delete_copy_keeps_cloudinary_file(self, mock_delete):
        copy = Document.objects.create(
            title="DBMS Unit 1", description="",
            file_name="notes.pdf", file_size=1024,
            cloudinary_url="https://res.cloudinary.com/x/raw/upload/v1/n.pdf",
            public_id="shared/pid-1",
            branch=self.branch, section=self.section_b,
            semester=self.semester, category=self.category,
            subject=self.subject, uploaded_by=self.cr_b,
            forked_from=self.source,
        )
        client = self._client(self.cr_b)
        response = client.delete(f"/api/documents/{copy.id}/")
        self.assertEqual(response.status_code, 204)
        # The file is still referenced by the source row -> never sent to Cloudinary.
        mock_delete.assert_not_called()
        self.assertTrue(Document.objects.filter(pk=self.source.id).exists())

    def test_delete_last_copy_removes_cloudinary_file(self, mock_delete):
        client = self._client(self.cr_a)
        response = client.delete(f"/api/documents/{self.source.id}/")
        self.assertEqual(response.status_code, 204)
        mock_delete.assert_called_once_with(["shared/pid-1"], resource_type="raw")


class ShareRequestTests(TestCase):
    """CR-initiated share requests between sections (no Cloudinary needed)."""

    def setUp(self):
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )
        self.branch = Branch.objects.create(name="CSE")
        self.section_a = Section.objects.create(branch=self.branch, name="A")
        self.section_b = Section.objects.create(branch=self.branch, name="B")
        self.section_c = Section.objects.create(branch=self.branch, name="C")
        self.semester = Semester.objects.create(name="3-1", order=5)
        self.category = Category.objects.create(name="Notes")
        self.subject = Subject.objects.create(
            name="DBMS", code="CS303", semester=self.semester, branch=self.branch
        )
        self.cr_a = User.objects.create_user(
            roll_number="cra", password="x", full_name="CR A",
            branch=self.branch, section=self.section_a, role=User.Role.CR,
        )
        self.cr_b = User.objects.create_user(
            roll_number="crb", password="x", full_name="CR B",
            branch=self.branch, section=self.section_b, role=User.Role.CR,
        )
        self.cr_c = User.objects.create_user(
            roll_number="crc", password="x", full_name="CR C",
            branch=self.branch, section=self.section_c, role=User.Role.CR,
        )
        self.student = User.objects.create_user(
            roll_number="st1", password="x", full_name="Student",
            branch=self.branch, section=self.section_b,
        )
        self.source = Document.objects.create(
            title="DBMS Unit 1", description="",
            file_name="notes.pdf", file_size=1024,
            cloudinary_url="https://res.cloudinary.com/x/raw/upload/v1/n.pdf",
            public_id="shared/pid-2",
            branch=self.branch, section=self.section_a,
            semester=self.semester, category=self.category,
            subject=self.subject, uploaded_by=self.cr_a,
        )

    def _client(self, user):
        from rest_framework_simplejwt.tokens import AccessToken

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
        return client

    def test_cr_requests_share_with_other_sections(self):
        client = self._client(self.cr_a)
        response = client.post(
            f"/api/documents/{self.source.id}/share_request/",
            {"sections": [self.section_b.id, self.section_c.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(
            DocumentShareRequest.objects.filter(document=self.source, status="PENDING").count(),
            2,
        )

    def test_duplicate_pending_requests_are_skipped(self):
        client = self._client(self.cr_a)
        client.post(
            f"/api/documents/{self.source.id}/share_request/",
            {"sections": [self.section_b.id]},
            format="json",
        )
        response = client.post(
            f"/api/documents/{self.source.id}/share_request/",
            {"sections": [self.section_b.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 0)

    def test_cr_cannot_request_share_for_other_sections_document(self):
        client = self._client(self.cr_b)  # CR B trying to share A's document
        response = client.post(
            f"/api/documents/{self.source.id}/share_request/",
            {"sections": [self.section_c.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_student_cannot_create_share_request(self):
        client = self._client(self.student)
        response = client.post(
            f"/api/documents/{self.source.id}/share_request/",
            {"sections": [self.section_b.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_target_cr_accept_creates_copy(self):
        client = self._client(self.cr_a)
        req = client.post(
            f"/api/documents/{self.source.id}/share_request/",
            {"sections": [self.section_b.id]},
            format="json",
        ).data["requests"][0]
        resp = self._client(self.cr_b).post(
            f"/api/document-share-requests/{req['id']}/respond/",
            {"accept": True},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["status"], "ACCEPTED")
        copy = Document.objects.get(section_id=self.section_b.id, public_id="shared/pid-2")
        self.assertEqual(copy.forked_from_id, self.source.id)
        self.assertEqual(copy.uploaded_by_id, self.cr_b.id)

    def test_target_cr_decline_creates_no_copy(self):
        client = self._client(self.cr_a)
        req = client.post(
            f"/api/documents/{self.source.id}/share_request/",
            {"sections": [self.section_b.id]},
            format="json",
        ).data["requests"][0]
        resp = self._client(self.cr_b).post(
            f"/api/document-share-requests/{req['id']}/respond/",
            {"accept": False},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["status"], "DECLINED")
        self.assertFalse(
            Document.objects.filter(section_id=self.section_b.id, public_id="shared/pid-2").exists()
        )

    def test_non_target_cr_cannot_respond(self):
        client = self._client(self.cr_a)
        req = client.post(
            f"/api/documents/{self.source.id}/share_request/",
            {"sections": [self.section_b.id]},
            format="json",
        ).data["requests"][0]
        resp = self._client(self.cr_c).post(
            f"/api/document-share-requests/{req['id']}/respond/",
            {"accept": True},
            format="json",
        )
        self.assertIn(resp.status_code, (403, 404))

    def test_incoming_and_outgoing_scopes(self):
        client = self._client(self.cr_a)
        client.post(
            f"/api/documents/{self.source.id}/share_request/",
            {"sections": [self.section_b.id]},
            format="json",
        )
        incoming = self._client(self.cr_b).get("/api/document-share-requests/?scope=incoming")
        self.assertEqual(len(incoming.data["results"]), 1)
        outgoing = self._client(self.cr_a).get("/api/document-share-requests/?scope=outgoing")
        self.assertEqual(len(outgoing.data["results"]), 1)

    def test_requester_can_cancel_pending_request(self):
        client = self._client(self.cr_a)
        req = client.post(
            f"/api/documents/{self.source.id}/share_request/",
            {"sections": [self.section_b.id]},
            format="json",
        ).data["requests"][0]
        resp = client.delete(f"/api/document-share-requests/{req['id']}/")
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(DocumentShareRequest.objects.count(), 0)


class DocumentTreeTests(TestCase):
    """The student browser's single-request data source (Subjects → Units)."""

    def setUp(self):
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )
        self.branch = Branch.objects.create(name="CSE", code="CS")
        self.section_a = Section.objects.create(branch=self.branch, name="A")
        self.section_b = Section.objects.create(branch=self.branch, name="B")
        self.semester = Semester.objects.create(name="3-1", order=5)
        self.category = Category.objects.create(name="Notes")
        self.subject = Subject.objects.create(
            name="DBMS", code="CS303", semester=self.semester, branch=self.branch
        )
        self.student_a = User.objects.create_user(
            roll_number="st1", password="x", full_name="Student A",
            branch=self.branch, section=self.section_a,
        )
        self.doc_in_a = Document.objects.create(
            title="DBMS - Unit 1", description="",
            file_name="dbms.pdf", file_size=1024,
            cloudinary_url="https://x.example/dbms.pdf",
            public_id="pid-a", branch=self.branch, section=self.section_a,
            semester=self.semester, category=self.category,
            subject=self.subject, uploaded_by=self.admin,
        )
        # Same document in section B - must not leak into A's tree.
        Document.objects.create(
            title="DBMS - Unit 1", description="",
            file_name="dbms-b.pdf", file_size=1024,
            cloudinary_url="https://x.example/dbms-b.pdf",
            public_id="pid-b", branch=self.branch, section=self.section_b,
            semester=self.semester, category=self.category,
            subject=self.subject, uploaded_by=self.admin,
        )
        # A file deleted in Cloudinary must be hidden from the tree.
        Document.objects.create(
            title="DBMS - Unit 2", description="",
            file_name="missing.pdf", file_size=1024,
            cloudinary_url="https://x.example/missing.pdf",
            public_id="pid-missing", branch=self.branch, section=self.section_a,
            semester=self.semester, category=self.category,
            subject=self.subject, uploaded_by=self.admin,
            is_missing=True,
        )

    def _client(self, user):
        from rest_framework_simplejwt.tokens import AccessToken

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
        return client

    def test_tree_scopes_to_own_section_and_hides_missing(self):
        response = self._client(self.student_a).get("/api/documents/tree/")
        self.assertEqual(response.status_code, 200)
        data = response.data
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["id"], self.doc_in_a.id)

