"""Password hashers for special bulk operations."""

import os

from django.contrib.auth.hashers import PBKDF2PasswordHasher


class FastPBKDF2PasswordHasher(PBKDF2PasswordHasher):
    """PBKDF2-SHA256 at a reduced, env-tunable iteration count.

    Django 5.x hashes with 1,000,000 iterations, which costs ~400-500ms of
    CPU per login on small Render instances. This hasher keeps the SAME
    algorithm name (``pbkdf2_sha256``) but creates/verifies at a lower count
    (default 216,000 = Django 4.2's default, ~4x faster) so the login request
    finishes in well under a second.

    Because the algorithm name is unchanged, hashes created by the stock
    hasher (or by any previous PBKDF2 count) verify correctly - the stored
    hash carries its own iteration count - and Django automatically re-hashes
    them at the new count on the user's next successful login. Set
    ``PBKDF2_ITERATIONS=1000000`` in the environment to restore the framework
    default (maximum hash security).
    """

    algorithm = "pbkdf2_sha256"
    iterations = int(os.getenv("PBKDF2_ITERATIONS", "216000"))


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
