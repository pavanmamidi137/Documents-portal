from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient, APIRequestFactory

from apps.accounts.models import User
from apps.college.models import Branch, Category, Section, Semester, Subject

from .models import Document
from .serializers import DocumentCreateSerializer
from .services import build_folder, validate_pdf


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


class PdfValidationTests(TestCase):
    def test_rejects_non_pdf(self):
        fake = SimpleUploadedFile("notes.txt", b"hello", content_type="text/plain")
        with self.assertRaises(Exception):
            validate_pdf(fake)

    def test_accepts_pdf(self):
        fake = SimpleUploadedFile("notes.pdf", b"%PDF-1.4 fake", content_type="application/pdf")
        validate_pdf(fake)  # should not raise


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
        # download_url forces attachment
        self.assertIn("fl_attachment", doc.download_url)

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
