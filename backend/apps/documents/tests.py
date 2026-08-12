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

    def test_accepts_pdf_with_generic_octet_stream_mime(self):
        """WhatsApp/browser downloads often report application/octet-stream -
        the magic-byte check is the real validator, so a generic MIME must
        not false-reject a valid PDF."""
        fake = SimpleUploadedFile(
            "notes.pdf", b"%PDF-1.4 fake", content_type="application/octet-stream"
        )
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

    def test_upload_succeeds_with_generic_octet_stream_mime(self, mock_delete, mock_upload):
        """Valid PDFs with a generic MIME (WhatsApp/downloads) upload fine."""
        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/x/raw/upload/v1/wa.pdf",
            "public_id": "documents/cse/a/3-1/notes/dbms/wa123",
        }
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(self.admin)}")
        response = client.post(
            "/api/documents/",
            {
                "title": "WhatsApp Notes",
                "file": SimpleUploadedFile(
                    "notes.pdf", b"%PDF-1.4 fake pdf content",
                    content_type="application/octet-stream",
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
        mock_upload.assert_called_once()

    def test_large_docx_compressed_on_upload(self, mock_delete, mock_upload):
        import io
        import zipfile

        from django.conf import settings

        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/x/raw/upload/v1/report.docx",
            "public_id": "documents/cse/a/3-1/notes/dbms/report123",
        }
        # A >2MB DOCX-style zip stored without compression (repetitive content
        # re-zips to a fraction of its size).
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
            z.writestr("word/document.xml", b"repeat this text " * 400_000)
        original = buf.getvalue()
        self.assertGreater(len(original), settings.DOCUMENT_COMPRESS_AFTER_BYTES)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(self.admin)}")
        response = client.post(
            "/api/documents/",
            {
                "title": "Big Notes",
                "file": SimpleUploadedFile(
                    "report.docx",
                    original,
                    content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
        stored = Document.objects.first()
        self.assertIsNotNone(stored)
        self.assertLess(stored.file_size, len(original))
        # Cloudinary receives the compressed bytes.
        sent = mock_upload.call_args.args[0]
        self.assertLess(sent.size, len(original))

    def test_over_limit_docx_rescued_by_compression(self, mock_delete, mock_upload):
        import io
        import zipfile

        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/x/raw/upload/v1/report.docx",
            "public_id": "documents/cse/a/3-1/notes/dbms/report456",
        }
        # A 25MB stored-zip DOCX sits above the 20MB limit, but re-zips to a
        # tiny file, so compression rescues it.
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
            z.writestr("word/document.xml", b"a" * 25_000_000)
        original = buf.getvalue()
        self.assertGreater(len(original), 20 * 1024 * 1024)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(self.admin)}")
        response = client.post(
            "/api/documents/",
            {
                "title": "Huge Notes",
                "file": SimpleUploadedFile(
                    "big.docx",
                    original,
                    content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
        stored = Document.objects.first()
        self.assertIsNotNone(stored)
        self.assertLess(stored.file_size, 20 * 1024 * 1024)

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
        with patch("apps.documents.services.cloudinary_files_status") as mock_status:
            mock_status.return_value = {self.doc.public_id: False}
            response = self._client().get("/api/documents/check-files/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["missing_ids"], [self.doc.id])
        self.doc.refresh_from_db()
        self.assertTrue(self.doc.is_missing)

    def test_check_files_keeps_existing_files(self):
        with patch("apps.documents.services.cloudinary_files_status") as mock_status:
            mock_status.return_value = {self.doc.public_id: True}
            response = self._client().get("/api/documents/check-files/")
        self.assertEqual(response.data["missing_ids"], [])
        self.doc.refresh_from_db()
        self.assertFalse(self.doc.is_missing)

    def test_check_files_unknown_result_leaves_flag_alone(self):
        with patch("apps.documents.services.cloudinary_files_status") as mock_status:
            mock_status.return_value = None  # auth/network failure
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
        with patch("apps.documents.services.cloudinary_files_status") as mock_status:
            mock_status.return_value = {self.doc.public_id: True}
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


@patch("apps.documents.services.cloudinary.api.delete_resources")
class DocumentBulkDeleteTests(TestCase):
    """One-request bulk delete (scope + last-copy Cloudinary cleanup)."""

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
        self.doc1 = self._doc("DBMS Unit 1", "pid-1", self.section_a)
        self.doc2 = self._doc("DBMS Unit 2", "pid-2", self.section_a)

    def _doc(self, title, public_id, section):
        return Document.objects.create(
            title=title, description="",
            file_name="notes.pdf", file_size=1024,
            cloudinary_url="https://x.example/n.pdf",
            public_id=public_id, branch=self.branch, section=section,
            semester=self.semester, category=self.category,
            subject=self.subject, uploaded_by=self.admin,
        )

    def _client(self, user):
        from rest_framework_simplejwt.tokens import AccessToken

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
        return client

    def test_admin_bulk_delete_by_public_ids_removes_every_copy(self, mock_delete):
        """Grouped view: one public_id deletes the file from ALL sections."""
        # Same file also lives in section B (shared/forked copy).
        self._doc("DBMS Unit 1", "pid-1", self.section_b)
        response = self._client(self.admin).post(
            "/api/documents/bulk_delete/",
            {"public_ids": ["pid-1"]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deleted"], 2)
        # pid-1 is gone everywhere; the unrelated pid-2 file is untouched.
        self.assertEqual(Document.objects.count(), 1)
        self.assertFalse(Document.objects.filter(public_id="pid-1").exists())
        self.assertTrue(Document.objects.filter(public_id="pid-2").exists())
        # Both copies were the last ones -> the Cloudinary file is removed once.
        mock_delete.assert_called_once_with(["pid-1"], resource_type="raw")

    def test_cr_cannot_bulk_delete_by_public_ids(self, mock_delete):
        """public_ids deletes across sections - Super Admin only."""
        response = self._client(self.cr_a).post(
            "/api/documents/bulk_delete/",
            {"public_ids": ["pid-1"]},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Document.objects.filter(public_id="pid-1").exists())

    def test_admin_bulk_deletes_and_removes_cloudinary_files(self, mock_delete):
        response = self._client(self.admin).post(
            "/api/documents/bulk_delete/",
            {"ids": [self.doc1.id, self.doc2.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deleted"], 2)
        self.assertEqual(Document.objects.count(), 0)
        # Both files had no other copies - each is removed from Cloudinary.
        self.assertEqual(mock_delete.call_count, 2)

    def test_shared_copy_keeps_cloudinary_file(self, mock_delete):
        # Same file also lives in section B (shared/forked copy).
        self._doc("DBMS Unit 1", "pid-1", self.section_b)
        response = self._client(self.admin).post(
            "/api/documents/bulk_delete/",
            {"ids": [self.doc1.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deleted"], 1)
        # The file is still referenced by the section-B copy -> not deleted.
        mock_delete.assert_not_called()
        self.assertTrue(
            Document.objects.filter(public_id="pid-1", section=self.section_b).exists()
        )

    def test_cr_bulk_delete_scoped_to_own_section(self, mock_delete):
        other_section_doc = self._doc("Python Unit 1", "pid-3", self.section_b)
        response = self._client(self.cr_a).post(
            "/api/documents/bulk_delete/",
            {"ids": [self.doc1.id, other_section_doc.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deleted"], 1)
        self.assertFalse(Document.objects.filter(pk=self.doc1.id).exists())
        self.assertTrue(Document.objects.filter(pk=other_section_doc.id).exists())

    def test_admin_bulk_delete_all_matching(self, mock_delete):
        response = self._client(self.admin).post(
            "/api/documents/bulk_delete/",
            {"all_matching": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deleted"], 2)
        self.assertEqual(Document.objects.count(), 0)
        self.assertEqual(mock_delete.call_count, 2)

    def test_bulk_delete_all_matching_respects_filters(self, mock_delete):
        other = self._doc("Python Unit 1", "pid-3", self.section_b)
        response = self._client(self.admin).post(
            "/api/documents/bulk_delete/?section=%d" % self.section_a.id,
            {"all_matching": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deleted"], 2)
        # The section-B document is outside the active filter.
        self.assertTrue(Document.objects.filter(pk=other.id).exists())
        self.assertEqual(Document.objects.count(), 1)

    def test_cr_bulk_delete_all_matching_scoped_to_own_section(self, mock_delete):
        other = self._doc("Python Unit 1", "pid-3", self.section_b)
        response = self._client(self.cr_a).post(
            "/api/documents/bulk_delete/",
            {"all_matching": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deleted"], 2)
        self.assertTrue(Document.objects.filter(pk=other.id).exists())

    def test_bulk_delete_requires_ids_list(self, mock_delete):
        client = self._client(self.admin)
        self.assertEqual(client.post("/api/documents/bulk_delete/", {}, format="json").status_code, 400)
        self.assertEqual(
            client.post("/api/documents/bulk_delete/", {"ids": "1"}, format="json").status_code, 400
        )

    def test_student_cannot_bulk_delete(self, mock_delete):
        student = User.objects.create_user(
            roll_number="st1", password="x", full_name="Student",
            branch=self.branch, section=self.section_a,
        )
        response = self._client(student).post(
            "/api/documents/bulk_delete/",
            {"ids": [self.doc1.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 403)


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


class DocumentOcrTests(TestCase):
    """Text extraction for documents: pypdf for text PDFs, AI OCR for scanned."""

    def setUp(self):
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )
        self.student = User.objects.create_user(
            roll_number="st1", password="x", full_name="Student A"
        )
        self.branch = Branch.objects.create(name="CSE", code="CS")
        self.section_a = Section.objects.create(branch=self.branch, name="A")
        self.section_b = Section.objects.create(branch=self.branch, name="B")
        self.semester = Semester.objects.create(name="3-1", order=5)
        self.category = Category.objects.create(name="Notes")
        self.subject = Subject.objects.create(
            name="DBMS", code="CS303", semester=self.semester, branch=self.branch
        )
        self.student.branch = self.branch
        self.student.section = self.section_a
        self.student.save()

    def _pdf_bytes(self, text: str = "") -> bytes:
        """Build a tiny real PDF - with text for text-based, blank for scanned."""
        import fitz

        doc = fitz.open()
        page = doc.new_page()
        if text:
            page.insert_text((72, 72), text, fontsize=11)
        return doc.tobytes()

    def _doc(self, file_name="notes.pdf", **overrides):
        values = {
            "title": "DBMS Unit 1", "description": "",
            "file_name": file_name, "file_size": 1024,
            "cloudinary_url": "https://x.example/n.pdf",
            "public_id": "ocr-pid-1",
            "branch": self.branch, "section": self.section_a,
            "semester": self.semester, "category": self.category,
            "subject": self.subject, "uploaded_by": self.admin,
        }
        values.update(overrides)
        return Document.objects.create(**values)

    def _client(self, user):
        from rest_framework_simplejwt.tokens import AccessToken

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
        return client

    def test_text_pdf_read_directly_without_ai(self):
        """A text-based PDF is read with pypdf - free, no OCR, no credits."""
        from apps.placements.models import AiUsageLog

        doc = self._doc()
        client = self._client(self.admin)
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = (
                self._pdf_bytes("Intro to Database Management Systems")
            )
            with patch("apps.core.ocr.ocr_pdf_content") as mock_ocr:
                response = client.post(f"/api/documents/{doc.id}/extract_text/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["ocr_status"], "COMPLETE")
        self.assertIn("Database Management Systems", response.data["ocr_text"])
        mock_ocr.assert_not_called()
        doc.refresh_from_db()
        self.assertEqual(doc.ocr_status, "COMPLETE")
        self.assertFalse(
            AiUsageLog.objects.filter(action=AiUsageLog.Action.DOC_OCR).exists()
        )

    def test_scanned_pdf_uses_ocr_and_charges_college_admin(self):
        """A scanned PDF is OCR'd via AI and the tokens charge the Super Admin."""
        from apps.placements.models import AiUsageLog

        doc = self._doc()
        client = self._client(self.admin)

        def fake_ocr(content, usage_callback=None, **kwargs):
            if usage_callback:
                usage_callback(120, 30)
            return "OCR: student name, Python, SQL, projects"

        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = self._pdf_bytes("")
            with patch("apps.core.ocr.ocr_pdf_content", side_effect=fake_ocr):
                response = client.post(f"/api/documents/{doc.id}/extract_text/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["ocr_status"], "COMPLETE")
        self.assertIn("Python", response.data["ocr_text"])
        doc.refresh_from_db()
        self.assertEqual(doc.ocr_status, "COMPLETE")
        # OCR tokens are charged to the college's Super Admin, not the caller.
        usage = AiUsageLog.objects.filter(action=AiUsageLog.Action.DOC_OCR).first()
        self.assertIsNotNone(usage)
        self.assertEqual(usage.user_id, self.admin.id)
        self.assertEqual(usage.prompt_tokens, 120)
        self.assertEqual(usage.completion_tokens, 30)

    def test_scanned_pdf_ocr_failure_charges_nothing(self):
        """OCR that returns nothing marks FAILED without any credit charge."""
        from apps.placements.models import AiUsageLog

        doc = self._doc()
        client = self._client(self.admin)
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = self._pdf_bytes("")
            with patch("apps.core.ocr.ocr_pdf_content", return_value=""):
                response = client.post(f"/api/documents/{doc.id}/extract_text/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["ocr_status"], "FAILED")
        self.assertIn("OCR", response.data["ocr_error"])
        doc.refresh_from_db()
        self.assertEqual(doc.ocr_status, "FAILED")
        self.assertFalse(
            AiUsageLog.objects.filter(action=AiUsageLog.Action.DOC_OCR).exists()
        )

    def test_non_pdf_rejected(self):
        doc = self._doc(file_name="notes.docx")
        response = self._client(self.admin).post(f"/api/documents/{doc.id}/extract_text/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["ocr_status"], "FAILED")
        self.assertIn("Only PDF", response.data["ocr_error"])
        doc.refresh_from_db()
        self.assertEqual(doc.ocr_status, "FAILED")

    def test_complete_returns_cached_text_without_reprocessing(self):
        doc = self._doc(ocr_status="COMPLETE", ocr_text="cached text")
        with patch("apps.documents.ocr.extract_document_text") as mock_extract:
            response = self._client(self.admin).post(f"/api/documents/{doc.id}/extract_text/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["ocr_text"], "cached text")
        mock_extract.assert_not_called()

    def test_pending_returns_409_until_finished(self):
        from django.utils import timezone

        doc = self._doc(ocr_status="PENDING", ocr_updated_at=timezone.now())
        response = self._client(self.admin).post(f"/api/documents/{doc.id}/extract_text/")
        self.assertEqual(response.status_code, 409)

    def test_student_scoped_to_own_section(self):
        doc = self._doc(public_id="ocr-pid-a")
        # The document lives in section A - a section-B student can't see it.
        self.student.section = self.section_b
        self.student.save()
        response = self._client(self.student).post(f"/api/documents/{doc.id}/extract_text/")
        self.assertEqual(response.status_code, 404)

    def test_auto_extract_skips_non_pdf_uploads(self):
        """maybe_auto_extract returns immediately for non-PDF files (no PENDING)."""
        doc = self._doc(file_name="slides.pptx")
        from .services import maybe_auto_extract

        maybe_auto_extract(doc, self.admin)
        doc.refresh_from_db()
        self.assertEqual(doc.ocr_status, Document.OcrStatus.NONE)

    def test_share_and_fork_copy_ocr_fields(self):
        """Copies of the same file reuse the extracted text - no re-OCR."""
        source = self._doc(ocr_status="COMPLETE", ocr_text="shared ocr text")
        # Admin share to section B.
        response = self._client(self.admin).post(
            f"/api/documents/{source.id}/share/",
            {"sections": [self.section_b.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        copy = Document.objects.get(section_id=self.section_b.id, public_id="ocr-pid-1")
        self.assertEqual(copy.ocr_status, "COMPLETE")
        self.assertEqual(copy.ocr_text, "shared ocr text")

    def test_pdf_to_page_images_renders_real_pdf(self):
        """The shared render helper turns a real PDF into base64 page images
        (guards the PyMuPDF pages()/pages API drift)."""
        from apps.core.ocr import pdf_to_page_images

        images = pdf_to_page_images(self._pdf_bytes("Some text on the page"), max_pages=2)
        self.assertEqual(len(images), 1)
        self.assertTrue(images[0].startswith("data:image/png;base64,"))

    def test_pdf_to_page_images_caps_pages(self):
        import fitz

        from apps.core.ocr import pdf_to_page_images

        doc = fitz.open()
        for _ in range(3):
            doc.new_page()
        pdf = doc.tobytes()
        doc.close()
        images = pdf_to_page_images(pdf, max_pages=2)
        self.assertEqual(len(images), 2)

    def test_global_search_matches_ocr_text(self):
        """Words inside a scanned/OCR'd document are searchable."""
        self._doc(title="Physics Lab Manual", ocr_status="COMPLETE",
                  ocr_text="Ohm's law verification experiment kitna unique needle")
        response = self._client(self.admin).get(
            "/api/search/?q=needle"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["documents"]), 1)
        self.assertEqual(response.data["documents"][0]["title"], "Physics Lab Manual")


class GroupedListTests(TestCase):
    """Super-admin list: ONE row per file with every section listed on it."""

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
        self.cr = User.objects.create_user(
            roll_number="cr1", password="x", full_name="CR",
            branch=self.branch, section=self.section_a, role=User.Role.CR,
        )
        self.shared = self._doc("DBMS Unit 1", "pid-shared", self.section_a)
        # Same file in section B - the duplicate the grouped view collapses.
        self._doc("DBMS Unit 1", "pid-shared", self.section_b)
        self.other = self._doc("Python Unit 1", "pid-python", self.section_a)

    def _doc(self, title, public_id, section, downloads=0):
        return Document.objects.create(
            title=title, description="",
            file_name="notes.pdf", file_size=1024,
            cloudinary_url="https://x.example/n.pdf",
            public_id=public_id, branch=self.branch, section=section,
            semester=self.semester, category=self.category,
            subject=self.subject, uploaded_by=self.admin,
            downloads=downloads,
        )

    def _client(self, user):
        from rest_framework_simplejwt.tokens import AccessToken

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
        return client

    def test_grouped_list_returns_one_row_per_file_with_sections(self):
        self.shared.downloads = 3
        self.shared.save(update_fields=["downloads"])
        response = self._client(self.admin).get("/api/documents/?grouped=1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)  # files, not copies
        by_pid = {r["public_id"]: r for r in response.data["results"]}
        self.assertIn("pid-shared", by_pid)
        row = by_pid["pid-shared"]
        self.assertEqual(row["section_count"], 2)
        self.assertEqual(row["sections"], ["A", "B"])
        self.assertEqual(row["total_downloads"], 3)
        self.assertIn(row["section_name"], ["A", "B"])  # representative copy

    def test_plain_admin_list_still_returns_every_copy(self):
        response = self._client(self.admin).get("/api/documents/")
        self.assertEqual(response.data["count"], 3)
        self.assertNotIn("sections", response.data["results"][0])

    def test_grouped_param_ignored_for_cr(self):
        """CRs are scoped to their own section - grouping would hide nothing."""
        response = self._client(self.cr).get("/api/documents/?grouped=1")
        self.assertEqual(response.status_code, 200)
        # Only section A's two rows - the section-B copy stays invisible.
        self.assertEqual(response.data["count"], 2)
        self.assertNotIn("sections", response.data["results"][0])

    def test_grouped_list_respects_filters(self):
        response = self._client(self.admin).get(
            "/api/documents/?grouped=1&section=%d" % self.section_a.id
        )
        self.assertEqual(response.status_code, 200)
        # Filtered to section A: pid-shared now appears with only section A.
        self.assertEqual(response.data["count"], 2)
        row = next(
            r for r in response.data["results"] if r["public_id"] == "pid-shared"
        )
        self.assertEqual(row["sections"], ["A"])
        self.assertEqual(row["section_count"], 1)


class DocumentCompressionTests(TestCase):
    """Automatic compression shrinks image-heavy files without data loss."""

    def _noisy_image(self, size=(1200, 800), fmt="JPEG", quality=95) -> bytes:
        """A photo-like image (smooth gradient + noise) that compresses well."""
        import io
        import random

        from PIL import Image

        random.seed(7)
        w, h = size
        raw = bytearray()
        for y in range(h):
            for x in range(w):
                base = ((x * 255) // w + (y * 255) // h) // 2
                raw += bytes(
                    (base + random.randint(-25, 25)) % 256 for _ in range(3)
                )
        img = Image.frombytes("RGB", (w, h), bytes(raw))
        buf = io.BytesIO()
        img.save(buf, fmt, quality=quality)
        return buf.getvalue()

    def test_compress_pdf_shrinks_image_heavy_pdf(self):
        """Embedded images are re-encoded so the PDF gets genuinely smaller."""
        import fitz

        from .compress import compress_pdf

        jpeg = self._noisy_image()
        doc = fitz.open()
        page = doc.new_page(width=1200, height=800)
        page.insert_image(page.rect, stream=jpeg)
        original = doc.tobytes()
        doc.close()
        self.assertGreater(len(original), 100_000)

        result = compress_pdf(original)
        self.assertIsNotNone(result)
        self.assertLess(len(result), len(original))

    def test_compress_zip_shrinks_office_archive_with_media(self):
        """DOCX/PPTX media (JPEG) is re-encoded inside the re-zipped archive."""
        import io
        import zipfile

        from .compress import compress_zip

        jpeg = self._noisy_image()
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
            z.writestr("word/document.xml", b"<w:p>" + b"x" * 400_000 + b"</w:p>")
            z.writestr("word/media/image1.jpeg", jpeg)
        original = buf.getvalue()

        result = compress_zip(original)
        self.assertIsNotNone(result)
        self.assertLess(len(result), len(original))

    def test_compress_file_keeps_original_when_not_smaller(self):
        """A tiny text file is returned untouched (None) - never bloated."""
        from django.core.files.uploadedfile import SimpleUploadedFile

        from .compress import compress_file

        tiny = SimpleUploadedFile("notes.txt", b"hello")
        self.assertIsNone(compress_file(tiny))
        tiny.seek(0)
        self.assertEqual(tiny.read(), b"hello")

