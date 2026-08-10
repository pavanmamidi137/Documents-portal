# Add a Postgres-only trigram GIN index on the document `ocr_text` column so
# the `icontains` search inside OCR'd scanned documents (global search page)
# uses the index instead of a full scan on large document tables. Skipped on
# non-Postgres databases (local SQLite dev and the test runner) so
# `manage.py migrate` and tests keep working anywhere.
#
# All statements are idempotent (IF NOT EXISTS) so re-runs are safe.

from django.db import migrations


def _is_postgres(connection) -> bool:
    return connection.vendor == "postgresql"


def add_ocr_text_index(apps, schema_editor):
    if not _is_postgres(schema_editor.connection):
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS documents_document_ocr_text_trgm_idx "
            "ON documents_document USING gin (ocr_text gin_trgm_ops)"
        )


def remove_ocr_text_index(apps, schema_editor):
    if not _is_postgres(schema_editor.connection):
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("DROP INDEX IF EXISTS documents_document_ocr_text_trgm_idx")


class Migration(migrations.Migration):

    dependencies = [
        ("documents", "0008_document_ocr_error_document_ocr_status_and_more"),
    ]

    operations = [
        migrations.RunPython(add_ocr_text_index, remove_ocr_text_index),
    ]
