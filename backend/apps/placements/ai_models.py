"""AI Provider Manager models.

Super Admins configure AI providers from the Admin Dashboard. Provider API keys
are encrypted at rest (AES-GCM, key derived from the server secret) and are
never returned by the API - serializers expose a masked preview only.

Architecture:
    AIProvider            - one configured provider (name, type, model, base URL,
                            priority, timeout, retries, enabled).
    AIProviderKey         - one or more API keys per provider (redundancy).
    AITaskConfiguration   - which provider (and fallback chain) serves each
                            AI task (DRIVE_EXTRACTION, STUDENT_CHAT, ...).
    AIProviderHealth      - health snapshot per provider (success/failure counts,
                            last error, status).
    AIRequestLog          - one row per AI call for the admin usage page.
    AISettings            - global AI switches (enable AI, fallback, caching,
                            web research, maintenance mode, default timeout).
"""

import base64
import hashlib
import os
import sys

from django.conf import settings
from django.db import models


# ---------------------------------------------------------------------------
# Encryption (AES-GCM via the cryptography package - a Django dependency)
# ---------------------------------------------------------------------------
def _is_running_tests() -> bool:
    # ``manage.py test ...`` - the only supported way the test runner starts.
    return len(sys.argv) > 1 and sys.argv[1] == "test"


def _encryption_key() -> bytes:
    """Derive a 32-byte AES key from AI_ENCRYPTION_KEY.

    Never hardcode a key; the value only ever lives in the server environment.
    In production (DEBUG off, not running tests) the key MUST be set
    explicitly: Render regenerates SECRET_KEY on every deploy, so silently
    encrypting with it would make saved provider keys undecryptable after the
    next redeploy. Local dev and the test runner fall back to SECRET_KEY.
    """
    secret = os.environ.get("AI_ENCRYPTION_KEY") or ""
    if not secret and not settings.DEBUG and not _is_running_tests():
        raise ValueError(
            "AI_ENCRYPTION_KEY is not set. Provider API keys cannot be safely "
            "encrypted - set AI_ENCRYPTION_KEY in the server environment."
        )
    if not secret:
        # Local dev / tests only - SECRET_KEY is stable for the local DB.
        secret = settings.SECRET_KEY
    return hashlib.sha256(secret.encode("utf-8")).digest()


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a provider API key for storage. Returns 'enc:v1:<b64>'."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    if not plaintext:
        return ""
    nonce = os.urandom(12)
    ciphertext = AESGCM(_encryption_key()).encrypt(nonce, plaintext.encode("utf-8"), None)
    return "enc:v1:" + base64.b64encode(nonce + ciphertext).decode("ascii")


def decrypt_secret(stored: str) -> str:
    """Decrypt a stored provider API key. Returns '' for empty/garbage values."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    if not stored:
        return ""
    if not stored.startswith("enc:v1:"):
        # Legacy plaintext values (should not exist) - refuse to use them.
        return ""
    try:
        raw = base64.b64decode(stored[len("enc:v1:") :])
        nonce, ciphertext = raw[:12], raw[12:]
        return AESGCM(_encryption_key()).decrypt(nonce, ciphertext, None).decode("utf-8")
    except Exception:
        return ""


def mask_secret(stored: str) -> str:
    """'********abcd' style preview of a stored (encrypted) key."""
    if not stored:
        return ""
    plain = decrypt_secret(stored)
    if not plain:
        return ""
    if len(plain) <= 4:
        return "*" * len(plain)
    return "*" * (len(plain) - 4) + plain[-4:]


class AIProvider(models.Model):
    """A configured AI provider (Gemini, NVIDIA, Groq, Cerebras, custom...)."""

    class ProviderType(models.TextChoices):
        OPENAI_COMPATIBLE = "OPENAI_COMPATIBLE", "OpenAI Compatible"
        GEMINI = "GEMINI", "Google Gemini"
        NVIDIA = "NVIDIA", "NVIDIA"
        GROQ = "GROQ", "Groq"
        CEREBRAS = "CEREBRAS", "Cerebras"

    class Purpose(models.TextChoices):
        GENERAL = "GENERAL", "General / All tasks"
        DRIVE_EXTRACTION = "DRIVE_EXTRACTION", "Drive Extraction"
        CHAT = "CHAT", "Student Chat"
        RESUME = "RESUME", "Resume Analysis"
        WEB = "WEB", "Web Research"

    class Health(models.TextChoices):
        HEALTHY = "HEALTHY", "Healthy"
        DEGRADED = "DEGRADED", "Degraded"
        RATE_LIMITED = "RATE_LIMITED", "Rate Limited"
        UNAVAILABLE = "UNAVAILABLE", "Unavailable"
        DISABLED = "DISABLED", "Disabled"
        UNKNOWN = "UNKNOWN", "Unknown"

    name = models.CharField(max_length=80, unique=True)
    provider_type = models.CharField(
        max_length=20, choices=ProviderType.choices, default=ProviderType.OPENAI_COMPATIBLE
    )
    model = models.CharField(max_length=120)
    # OpenAI-compatible base URL (e.g. https://integrate.api.nvidia.com/v1).
    # For GEMINI this is ignored - the official API base is used.
    base_url = models.URLField(max_length=300, blank=True, default="")
    # Encrypted primary API key. Additional keys live in AIProviderKey.
    encrypted_api_key = models.TextField(blank=True, default="")
    priority = models.PositiveIntegerField(default=100, help_text="Lower = tried first")
    enabled = models.BooleanField(default=True, db_index=True)
    timeout_seconds = models.PositiveIntegerField(default=60)
    max_retries = models.PositiveIntegerField(default=2)
    purpose = models.CharField(
        max_length=20, choices=Purpose.choices, default=Purpose.GENERAL
    )
    # Health snapshot (updated by the router - lightweight, no polling).
    health = models.CharField(
        max_length=20, choices=Health.choices, default=Health.UNKNOWN, db_index=True
    )
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    last_error_type = models.CharField(max_length=40, blank=True, default="")
    consecutive_failures = models.PositiveIntegerField(default=0)
    total_requests = models.PositiveIntegerField(default=0)
    total_errors = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["priority", "name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.model})"

    @property
    def api_key_masked(self) -> str:
        return mask_secret(self.encrypted_api_key)

    def set_api_key(self, plaintext: str) -> None:
        """Encrypt and store a new API key (no-op for empty strings)."""
        if plaintext:
            self.encrypted_api_key = encrypt_secret(plaintext)


class AIProviderKey(models.Model):
    """Extra API keys for one provider (redundancy / separate accounts)."""

    provider = models.ForeignKey(
        AIProvider, on_delete=models.CASCADE, related_name="keys"
    )
    encrypted_api_key = models.TextField(blank=True, default="")
    note = models.CharField(max_length=120, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"{self.provider.name} key #{self.id}"

    @property
    def api_key_masked(self) -> str:
        return mask_secret(self.encrypted_api_key)

    def set_api_key(self, plaintext: str) -> None:
        if plaintext:
            self.encrypted_api_key = encrypt_secret(plaintext)


class AITaskConfiguration(models.Model):
    """Which provider (and fallback chain) serves each AI task."""

    class Task(models.TextChoices):
        DRIVE_EXTRACTION = "DRIVE_EXTRACTION", "Drive Extraction"
        DRIVE_SUMMARY = "DRIVE_SUMMARY", "Drive Summary"
        STUDENT_CHAT = "STUDENT_CHAT", "Student Chat"
        ELIGIBILITY_ANALYSIS = "ELIGIBILITY_ANALYSIS", "Eligibility Analysis"
        RESUME_ANALYSIS = "RESUME_ANALYSIS", "Resume Analysis"
        WEB_RESEARCH = "WEB_RESEARCH", "Web Research"
        GENERAL = "GENERAL", "General Placement AI"

    task = models.CharField(max_length=30, choices=Task.choices, unique=True)
    primary = models.ForeignKey(
        AIProvider, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    fallback_1 = models.ForeignKey(
        AIProvider, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    fallback_2 = models.ForeignKey(
        AIProvider, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    fallback_3 = models.ForeignKey(
        AIProvider, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["task"]

    def __str__(self) -> str:
        return self.task

    def provider_chain(self) -> list:
        """[primary, fallback_1, ...] with None removed."""
        return [p for p in (self.primary, self.fallback_1, self.fallback_2, self.fallback_3) if p]


class AIProviderHealth(models.Model):
    """Health snapshot per provider (kept here so the provider row stays lean)."""

    provider = models.OneToOneField(
        AIProvider, on_delete=models.CASCADE, related_name="health_row"
    )
    status = models.CharField(
        max_length=20, choices=AIProvider.Health.choices, default=AIProvider.Health.UNKNOWN
    )
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    last_error_type = models.CharField(max_length=40, blank=True, default="")
    failure_count = models.PositiveIntegerField(default=0)
    success_count = models.PositiveIntegerField(default=0)
    last_used_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return f"{self.provider.name}: {self.status}"


class AIRequestLog(models.Model):
    """One row per AI call - for the admin usage/health pages.

    Never stores prompts, responses or API keys.
    """

    class Status(models.TextChoices):
        SUCCESS = "SUCCESS", "Success"
        FAILED = "FAILED", "Failed"

    provider = models.ForeignKey(
        AIProvider, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    task = models.CharField(max_length=30, blank=True, default="")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="ai_request_logs",
    )
    status = models.CharField(max_length=10, choices=Status.choices, db_index=True)
    # First provider tried vs the one that actually answered (for failover).
    primary_provider = models.CharField(max_length=80, blank=True, default="")
    provider_used = models.CharField(max_length=80, blank=True, default="")
    fallback_used = models.BooleanField(default=False, db_index=True)
    error_type = models.CharField(max_length=40, blank=True, default="")
    prompt_tokens = models.PositiveIntegerField(default=0)
    completion_tokens = models.PositiveIntegerField(default=0)
    latency_ms = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"[{self.task}] {self.provider_used or '?'} -> {self.status}"


class AISettings(models.Model):
    """Global AI switches configured by the Super Admin."""

    enable_ai = models.BooleanField(default=True)
    enable_fallback = models.BooleanField(default=True)
    enable_caching = models.BooleanField(default=True)
    enable_web_research = models.BooleanField(default=True)
    default_timeout_seconds = models.PositiveIntegerField(default=60)
    default_max_retries = models.PositiveIntegerField(default=2)
    maintenance_mode = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "AI settings"

    def __str__(self) -> str:
        return "AI settings"

    @classmethod
    def get(cls) -> "AISettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
