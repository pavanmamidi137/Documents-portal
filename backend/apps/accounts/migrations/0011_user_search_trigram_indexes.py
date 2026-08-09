# Add Postgres-only trigram GIN indexes so `icontains` searches on the user
# table (roll number / name / email / phone) use the index instead of a full
# scan on large batches. Skipped on non-Postgres databases (local SQLite dev
# and the test runner) so `manage.py migrate` and tests keep working anywhere.
#
# All statements are idempotent (IF NOT EXISTS) so re-runs are safe.

from django.db import migrations


def _is_postgres(connection) -> bool:
    return connection.vendor == "postgresql"


def add_trigram_indexes(apps, schema_editor):
    if not _is_postgres(schema_editor.connection):
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS accounts_user_roll_number_trgm_idx "
            "ON accounts_user USING gin (roll_number gin_trgm_ops)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS accounts_user_full_name_trgm_idx "
            "ON accounts_user USING gin (full_name gin_trgm_ops)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS accounts_user_email_trgm_idx "
            "ON accounts_user USING gin (email gin_trgm_ops)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS accounts_user_phone_trgm_idx "
            "ON accounts_user USING gin (phone gin_trgm_ops)"
        )


def remove_trigram_indexes(apps, schema_editor):
    if not _is_postgres(schema_editor.connection):
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("DROP INDEX IF EXISTS accounts_user_roll_number_trgm_idx")
        cursor.execute("DROP INDEX IF EXISTS accounts_user_full_name_trgm_idx")
        cursor.execute("DROP INDEX IF EXISTS accounts_user_email_trgm_idx")
        cursor.execute("DROP INDEX IF EXISTS accounts_user_phone_trgm_idx")


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0010_alter_user_passout_year"),
    ]

    operations = [
        migrations.RunPython(add_trigram_indexes, remove_trigram_indexes),
    ]
