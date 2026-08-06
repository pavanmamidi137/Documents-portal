"""
Django settings for the College Document Management Portal.

Production configuration:
  - Supabase PostgreSQL (transaction-mode pooler at runtime, session-mode for migrations)
  - SimpleJWT authentication (roll number + password)
  - Cloudinary for PDF storage
  - Whitenoise + Gunicorn for Render
"""
import os
import sys
from datetime import timedelta
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables from backend/.env
load_dotenv(BASE_DIR / ".env")


def _env_list(name: str, default: str = "") -> list[str]:
    return [part.strip() for part in os.getenv(name, default).split(",") if part.strip()]


# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "django-insecure-local-dev-key-change-me")

DEBUG = os.getenv("DJANGO_DEBUG", "False").lower() in ("1", "true", "yes")

ALLOWED_HOSTS = _env_list("DJANGO_ALLOWED_HOSTS", "*")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    # Local apps
    "apps.core",
    "apps.accounts",
    "apps.college",
    "apps.documents",
    "apps.announcements",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# ---------------------------------------------------------------------------
# Database - Supabase PostgreSQL
# ---------------------------------------------------------------------------
# Runtime traffic goes through the shared transaction-mode pooler (IPv4-only).
# Migrations / admin commands use the session-mode pooler (DIRECT_URL).
_RUNTIME_URL = os.getenv("DATABASE_URL", "").strip()
_DIRECT_URL = os.getenv("DIRECT_URL", "").strip()


def _clean_postgres_url(url: str) -> str:
    """Drop Supabase pooler hints (e.g. pgbouncer=true) that psycopg2 rejects."""
    import urllib.parse

    parsed = urllib.parse.urlparse(url)
    if not parsed.query:
        return url
    kept = [
        (k, v)
        for k, v in urllib.parse.parse_qsl(parsed.query)
        if k.lower() != "pgbouncer"
    ]
    if "sslmode" not in {k.lower() for k, _ in kept}:
        kept.append(("sslmode", "require"))
    query = urllib.parse.urlencode(kept)
    return urllib.parse.urlunparse(parsed._replace(query=query))


_use_direct_url = any(cmd in sys.argv for cmd in ("migrate", "dbshell", "shell", "test"))
_db_url = _DIRECT_URL if _use_direct_url else _RUNTIME_URL

if _db_url:
    DATABASES = {"default": dj_database_url.parse(_clean_postgres_url(_db_url))}
    # Safe defaults for the Supabase pgbouncer (transaction mode)
    DATABASES["default"]["CONN_MAX_AGE"] = 0
    DATABASES["default"]["CONN_HEALTH_CHECKS"] = True
    DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True
else:
    # Local fallback (development / tests) - no external service required.
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_USER_MODEL = "accounts.User"

# ---------------------------------------------------------------------------
# DRF + JWT
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_FILTER_BACKENDS": (
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_THROTTLE_RATES": {
        # Rates are env-tunable (e.g. tests raise them to avoid cross-test
        # throttling from the shared LocMem cache).
        "login": os.getenv("THROTTLE_LOGIN_RATE", "10/min"),
        "user": os.getenv("THROTTLE_USER_RATE", "300/min"),
        "anon": os.getenv("THROTTLE_ANON_RATE", "30/min"),
    },
    "DATETIME_FORMAT": "%Y-%m-%dT%H:%M:%S%z",
}

# Password hashers. ImportPBKDF2PasswordHasher is listed LAST so it is only
# ever used for verifying hashes produced by bulk CSV imports (it is never
# chosen as the default upgrade target).
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
    "django.contrib.auth.hashers.MD5PasswordHasher",
    "apps.accounts.hashers.ImportPBKDF2PasswordHasher",
]

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=int(os.getenv("JWT_ACCESS_MINUTES", "30"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=int(os.getenv("JWT_REFRESH_DAYS", "7"))),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = _env_list(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
)
CORS_ALLOW_CREDENTIALS = True

# ---------------------------------------------------------------------------
# Cloudinary
# ---------------------------------------------------------------------------
CLOUDINARY = {
    "CLOUD_NAME": os.getenv("CLOUDINARY_CLOUD_NAME", ""),
    "API_KEY": os.getenv("CLOUDINARY_API_KEY", ""),
    "API_SECRET": os.getenv("CLOUDINARY_API_SECRET", ""),
}
# Max upload size for documents (PDF / PPT / PPTX / DOC / DOCX / TXT).
MAX_DOCUMENT_SIZE_MB = int(
    os.getenv("MAX_DOCUMENT_SIZE_MB", os.getenv("MAX_PDF_SIZE_MB", "20"))
)

# ---------------------------------------------------------------------------
# Static files (Whitenoise for Render)
# ---------------------------------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
