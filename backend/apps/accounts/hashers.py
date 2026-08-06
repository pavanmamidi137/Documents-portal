"""Password hashers for special bulk operations."""

from django.contrib.auth.hashers import PBKDF2PasswordHasher


class ImportPBKDF2PasswordHasher(PBKDF2PasswordHasher):
    """Low-iteration PBKDF2 used ONLY for bulk CSV imports.

    A bulk-imported account's default password is its roll number, which is
    not a secret - hashing every row at full PBKDF2 strength would make large
    imports take minutes on shared hosting. The encoded hash stores its own
    iteration count, so verification works normally, and Django automatically
    re-hashes it with the strong default hasher the first time the student
    logs in.
    """

    algorithm = "pbkdf2_sha256_import"
    iterations = 1_000
