"""Tests for the AI Provider Manager and AI Router."""

from unittest.mock import patch

from rest_framework.test import APIClient, APITestCase

from apps.accounts.models import User

from .ai_models import (
    AIProvider,
    AIProviderHealth,
    AIProviderKey,
    AIRequestLog,
    AISettings,
    AITaskConfiguration,
    decrypt_secret,
    mask_secret,
)
from .ai_router import AIService, AIServiceUnavailable


class AiManagerBase(APITestCase):
    def setUp(self):
        # Defensive isolation: the router may create rows during a previous
        # test's AI calls - make every test start from a clean AI state.
        AIProvider.objects.all().delete()
        AIRequestLog.objects.all().delete()
        AIProviderHealth.objects.all().delete()
        AITaskConfiguration.objects.all().delete()
        AISettings.objects.all().delete()
        self.admin = User.objects.create_superuser(
            roll_number="admin", password="x", full_name="Admin"
        )
        self.student = User.objects.create_user(
            roll_number="21CSE01", password="x", full_name="Diya"
        )

    def _client(self, user):
        from rest_framework_simplejwt.tokens import AccessToken

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
        return client

    def _provider(self, name="Gemini", priority=1, enabled=True, **kwargs):
        provider = AIProvider(
            name=name,
            provider_type=kwargs.pop("provider_type", AIProvider.ProviderType.GEMINI),
            model=kwargs.pop("model", "gemini-2.0-flash"),
            priority=priority,
            enabled=enabled,
            **kwargs,
        )
        provider.set_api_key("sk-test-abcdef-1234")
        provider.save()
        AIProviderHealth.objects.get_or_create(provider=provider)
        return provider

    def _payload(self, **overrides):
        data = {
            "name": "Groq",
            "provider_type": "GROQ",
            "model": "llama-3.3-70b-versatile",
            "base_url": "https://api.groq.com/openai/v1",
            "api_key": "gsk-secret-xyz",
            "priority": 3,
            "enabled": True,
            "timeout_seconds": 60,
            "max_retries": 2,
            "purpose": "GENERAL",
        }
        data.update(overrides)
        return data


class AiProviderAuthTests(AiManagerBase):
    def test_student_cannot_access_provider_endpoints(self):
        client = self._client(self.student)
        for method, url in [
            ("get", "/api/admin/ai/providers/"),
            ("post", "/api/admin/ai/providers/"),
            ("get", "/api/admin/ai/tasks/"),
            ("get", "/api/admin/ai/settings/"),
            ("get", "/api/admin/ai/health/"),
            ("get", "/api/admin/ai/usage/"),
        ]:
            resp = getattr(client, method)(url, {} if method == "post" else None)
            self.assertIn(resp.status_code, (401, 403), f"{method} {url}")

    def test_anonymous_cannot_access_provider_endpoints(self):
        resp = self.client.get("/api/admin/ai/providers/")
        self.assertIn(resp.status_code, (401, 403))

    def test_admin_can_list_providers(self):
        self._provider(name="Gemini")
        resp = self._client(self.admin).get("/api/admin/ai/providers/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)
        self.assertEqual(len(resp.data["results"]), 1)


class AiProviderCrudTests(AiManagerBase):
    def test_create_provider_encrypts_and_masks_key(self):
        resp = self._client(self.admin).post(
            "/api/admin/ai/providers/", self._payload(), format="json"
        )
        self.assertEqual(resp.status_code, 201)
        provider = AIProvider.objects.get(name="Groq")
        # Stored value is encrypted, never plaintext.
        self.assertNotIn("gsk-secret-xyz", provider.encrypted_api_key)
        self.assertEqual(decrypt_secret(provider.encrypted_api_key), "gsk-secret-xyz")
        # Response contains only the masked key.
        self.assertNotIn("gsk-secret-xyz", resp.data["api_key_masked"])
        self.assertTrue(resp.data["api_key_masked"].endswith("xyz"))
        self.assertNotIn("api_key", resp.data)

    def test_edit_provider_updates_key_only_when_sent(self):
        provider = self._provider(name="Gemini")
        client = self._client(self.admin)
        # Change model + priority without sending a key.
        resp = client.patch(
            f"/api/admin/ai/providers/{provider.id}/",
            {"model": "gemini-1.5-flash", "priority": 5},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        provider.refresh_from_db()
        self.assertEqual(provider.model, "gemini-1.5-flash")
        self.assertEqual(decrypt_secret(provider.encrypted_api_key), "sk-test-abcdef-1234")
        # Now rotate the key.
        resp = client.patch(
            f"/api/admin/ai/providers/{provider.id}/",
            {"api_key": "new-key-9999"},
            format="json",
        )
        provider.refresh_from_db()
        self.assertEqual(decrypt_secret(provider.encrypted_api_key), "new-key-9999")

    def test_delete_provider(self):
        provider = self._provider(name="Gemini")
        resp = self._client(self.admin).delete(f"/api/admin/ai/providers/{provider.id}/")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(AIProvider.objects.filter(pk=provider.pk).exists())

    def test_provider_key_never_appears_in_usage_or_health(self):
        provider = self._provider(name="Gemini")
        AIRequestLog.objects.create(
            provider=provider,
            provider_used="Gemini",
            primary_provider="Gemini",
            task="STUDENT_CHAT",
            user=self.student,
            status=AIRequestLog.Status.SUCCESS,
            prompt_tokens=10,
            completion_tokens=5,
        )
        client = self._client(self.admin)
        usage = client.get("/api/admin/ai/usage/").data
        health = client.get("/api/admin/ai/health/").data
        serialized = f"{usage}{health}"
        self.assertNotIn("sk-test-abcdef-1234", serialized)
        self.assertNotIn("enc:v1:", serialized)


class AiProviderTestConnectionTests(AiManagerBase):
    @patch("apps.placements.ai_router.adapter_for")
    def test_test_connection_success(self, mock_adapter):
        provider = self._provider(name="Gemini")
        mock_adapter.return_value.test.return_value = None
        resp = self._client(self.admin).post(f"/api/admin/ai/providers/{provider.id}/test/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["ok"])
        provider.health_row.refresh_from_db()
        self.assertEqual(provider.health_row.status, "HEALTHY")

    @patch("apps.placements.ai_router.adapter_for")
    def test_test_connection_auth_failure_is_friendly(self, mock_adapter):
        from .ai_adapters import AuthProviderError

        provider = self._provider(name="Gemini")
        mock_adapter.return_value.test.side_effect = AuthProviderError(
            "bad key", error_type="AUTH"
        )
        resp = self._client(self.admin).post(f"/api/admin/ai/providers/{provider.id}/test/")
        self.assertEqual(resp.status_code, 502)
        self.assertFalse(resp.data["ok"])
        self.assertIn("Invalid API key", resp.data["detail"])
        self.assertNotIn("bad key", resp.data["detail"])


class AiRouterFailoverTests(AiManagerBase):
    @patch("apps.placements.ai_router.adapter_for")
    def test_failover_primary_429_then_fallback(self, mock_adapter):
        from .ai_adapters import RateLimitedProviderError

        primary = self._provider(name="Gemini", priority=1)
        fallback = self._provider(name="Groq", priority=2, provider_type="GROQ")
        AISettings.get()  # create the singleton first, then update it
        AISettings.objects.update(enable_caching=False)

        fail = RateLimitedProviderError("busy", error_type="RATE_LIMITED")
        mock_adapter.side_effect = [None, None]

        def fake_adapter(provider):
            class Fake:
                def __init__(self, provider):
                    self.provider = provider

                def generate(self, *a, **kw):
                    if self.provider.pk == primary.pk:
                        raise fail
                    return "fallback answer", 20, 10

            return Fake(provider)

        mock_adapter.side_effect = fake_adapter

        answer = AIService.generate(
            task="STUDENT_CHAT", system_prompt="sys", user_text="hello",
            user=self.student, cacheable=False,
        )
        self.assertEqual(answer, "fallback answer")
        log = AIRequestLog.objects.latest("id")
        self.assertTrue(log.fallback_used)
        self.assertEqual(log.provider_used, "Groq")
        self.assertEqual(log.primary_provider, "Gemini")

    @patch("apps.placements.ai_router.adapter_for")
    def test_all_providers_fail(self, mock_adapter):
        from .ai_adapters import UnavailableProviderError

        self._provider(name="Gemini", priority=1)
        self._provider(name="Groq", priority=2, provider_type="GROQ")
        AISettings.get()
        AISettings.objects.update(enable_caching=False)

        def fake_adapter(provider):
            class Fake:
                def generate(self, *a, **kw):
                    raise UnavailableProviderError("down", error_type="HTTP_503")

            return Fake()

        mock_adapter.side_effect = fake_adapter
        with self.assertRaises(AIServiceUnavailable):
            AIService.generate(
                task="STUDENT_CHAT", system_prompt="sys", user_text="hello",
                user=self.student, cacheable=False,
            )
        self.assertEqual(AIRequestLog.objects.filter(status="FAILED").count(), 2)

    @patch("apps.placements.ai_router.adapter_for")
    def test_disabled_provider_is_skipped(self, mock_adapter):
        self._provider(name="Gemini", priority=1, enabled=False)
        fallback = self._provider(name="Groq", priority=2, provider_type="GROQ")

        def fake_adapter(provider):
            class Fake:
                def generate(self, *a, **kw):
                    return f"answer from {fallback.name}", 5, 5

            return Fake()

        mock_adapter.side_effect = fake_adapter
        answer = AIService.generate(
            task="STUDENT_CHAT", system_prompt="sys", user_text="hi",
            user=self.student, cacheable=False,
        )
        self.assertEqual(answer, "answer from Groq")
        log = AIRequestLog.objects.latest("id")
        self.assertEqual(log.provider_used, "Groq")

    @patch("apps.placements.ai_router.adapter_for")
    def test_priority_ordering(self, mock_adapter):
        low = self._provider(name="Low", priority=10)
        high = self._provider(name="High", priority=1)
        self._provider(name="Mid", priority=5)

        calls = []

        def fake_adapter(provider):
            def generate(*a, **kw):
                calls.append(provider.name)
                return f"from {provider.name}", 5, 5

            return SimpleAdapter(generate)

        mock_adapter.side_effect = fake_adapter
        AIService.generate(
            task="STUDENT_CHAT", system_prompt="s", user_text="q",
            user=self.student, cacheable=False,
        )
        # The first enabled provider in priority order answers.
        self.assertEqual(calls[0], "High")


class SimpleAdapter:
    def __init__(self, generate):
        self._generate = generate

    def generate(self, *a, **kw):
        return self._generate(*a, **kw)


class AiProviderKeyApiTests(AiManagerBase):
    def test_add_and_remove_extra_key(self):
        provider = self._provider(name="Gemini")
        client = self._client(self.admin)
        resp = client.post(
            f"/api/admin/ai/providers/{provider.id}/add_key/",
            {"api_key": "second-key-abc", "note": "backup account"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        key = AIProviderKey.objects.get(provider=provider)
        self.assertEqual(decrypt_secret(key.encrypted_api_key), "second-key-abc")
        self.assertNotIn("second-key-abc", resp.data["masked"])
        # The provider serializer lists masked extra keys only.
        listing = client.get("/api/admin/ai/providers/").data
        extra = next(
            k for p in listing["results"] if p["id"] == provider.id
            for k in p["extra_keys"]
        )
        self.assertEqual(extra["id"], key.id)
        self.assertNotIn("second-key-abc", str(listing))
        # Remove it.
        resp = client.post(
            f"/api/admin/ai/providers/{provider.id}/remove_key/",
            {"key_id": key.id},
            format="json",
        )
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(AIProviderKey.objects.filter(pk=key.pk).exists())

    def test_add_key_requires_a_key(self):
        provider = self._provider(name="Gemini")
        resp = self._client(self.admin).post(
            f"/api/admin/ai/providers/{provider.id}/add_key/",
            {"api_key": ""},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_student_cannot_add_key(self):
        provider = self._provider(name="Gemini")
        resp = self._client(self.student).post(
            f"/api/admin/ai/providers/{provider.id}/add_key/",
            {"api_key": "x"},
            format="json",
        )
        self.assertIn(resp.status_code, (401, 403))

    def test_mask_secret_tail_preview(self):
        from .ai_models import encrypt_secret

        short = encrypt_secret("abcd")
        self.assertEqual(mask_secret(short), "****")
        long = encrypt_secret("sk-1234567890")  # 13 chars -> 9 stars + tail
        self.assertEqual(mask_secret(long), "*********7890")
        self.assertEqual(mask_secret(""), "")


class AiDailyReportTests(AiManagerBase):
    def _log(self, provider, status, tokens=(10, 5), error_type="", fallback=False):
        AIRequestLog.objects.create(
            provider_id=provider.pk if provider else None,
            provider_used=provider.name if provider else "",
            primary_provider=provider.name if provider else "",
            task="STUDENT_CHAT",
            user=self.student,
            status=status,
            fallback_used=fallback,
            error_type=error_type,
            prompt_tokens=tokens[0],
            completion_tokens=tokens[1],
        )

    def test_report_is_none_without_activity(self):
        from .ai_report import build_daily_report

        self.assertIsNone(build_daily_report())

    def test_report_builds_totals_and_provider_stats(self):
        from .ai_report import build_daily_report, estimate_cost

        gemini = self._provider(name="Gemini")
        groq = self._provider(name="Groq", provider_type="GROQ")
        self._log(gemini, AIRequestLog.Status.SUCCESS, (100, 20))
        self._log(gemini, AIRequestLog.Status.SUCCESS, (50, 10))
        self._log(groq, AIRequestLog.Status.FAILED, (10, 0), error_type="RATE_LIMITED")
        self._log(groq, AIRequestLog.Status.SUCCESS, (30, 5), fallback=True)

        report = build_daily_report()
        self.assertEqual(report["totals"]["calls"], 4)
        self.assertEqual(report["totals"]["success"], 3)
        self.assertEqual(report["totals"]["errors"], 1)
        self.assertEqual(report["totals"]["fallbacks"], 1)
        self.assertEqual(report["totals"]["prompt_tokens"], 190)
        self.assertEqual(report["totals"]["completion_tokens"], 35)
        self.assertEqual(report["top_error_types"], [{"type": "RATE_LIMITED", "count": 1}])
        self.assertEqual(report["providers"]["Gemini"]["calls"], 2)
        self.assertEqual(report["providers"]["Gemini"]["uptime_pct"], 100.0)
        self.assertEqual(report["providers"]["Groq"]["uptime_pct"], 50.0)
        self.assertEqual(report["totals"]["estimated_cost"], estimate_cost(190, 35))

    def test_report_notifies_admins(self):
        from apps.core.models import Notification

        from .ai_report import notify_admins_daily_report

        gemini = self._provider(name="Gemini")
        self._log(gemini, AIRequestLog.Status.SUCCESS)
        sent = notify_admins_daily_report()
        self.assertEqual(sent, 1)
        note = Notification.objects.get(kind=Notification.Kind.AI_REPORT)
        self.assertEqual(note.user, self.admin)
        self.assertIn("1 calls", note.message)
        self.assertEqual(note.link, "/admin/ai")

    def test_send_report_endpoint(self):
        gemini = self._provider(name="Gemini")
        self._log(gemini, AIRequestLog.Status.SUCCESS)
        resp = self._client(self.admin).post("/api/admin/ai/usage/send_report/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("sent", resp.data["detail"])
        # Students are locked out.
        resp = self._client(self.student).post("/api/admin/ai/usage/send_report/")
        self.assertIn(resp.status_code, (401, 403))


class AiTaskRoutingTests(AiManagerBase):
    def test_task_routing_patch_chain(self):
        primary = self._provider(name="Gemini", priority=1)
        fallback = self._provider(name="Groq", priority=2, provider_type="GROQ")
        config = AITaskConfiguration.objects.create(
            task=AITaskConfiguration.Task.STUDENT_CHAT, primary=primary
        )
        client = self._client(self.admin)
        resp = client.patch(
            f"/api/admin/ai/tasks/{config.id}/",
            {"primary": primary.id, "fallback_1": fallback.id, "fallback_2": None},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        config.refresh_from_db()
        self.assertEqual(config.fallback_1_id, fallback.id)
        self.assertIsNone(config.fallback_2_id)
    @patch("apps.placements.ai_router.adapter_for")
    def test_task_specific_routing(self, mock_adapter):
        chat_provider = self._provider(name="ChatLLM", priority=1)
        extract_provider = self._provider(name="ExtractLLM", priority=2, provider_type="GROQ")
        AITaskConfiguration.objects.create(
            task=AITaskConfiguration.Task.STUDENT_CHAT, primary=chat_provider
        )
        AITaskConfiguration.objects.create(
            task=AITaskConfiguration.Task.DRIVE_EXTRACTION, primary=extract_provider
        )

        used = []

        def fake_adapter(provider):
            def generate(*a, **kw):
                used.append(provider.name)
                return "answer", 5, 5

            return SimpleAdapter(generate)

        mock_adapter.side_effect = fake_adapter
        AIService.generate(
            task="STUDENT_CHAT", system_prompt="s", user_text="q",
            user=self.student, cacheable=False,
        )
        AIService.generate(
            task="DRIVE_EXTRACTION", system_prompt="s", user_text="q",
            user=self.student, cacheable=False,
        )
        self.assertEqual(used, ["ChatLLM", "ExtractLLM"])


class AiRouterCacheAndSettingsTests(AiManagerBase):
    @patch("apps.placements.ai_router.adapter_for")
    def test_cache_hit_skips_llm(self, mock_adapter):
        # Fresh singleton with caching ON (a previous test may have turned it off).
        AISettings.get()
        AISettings.objects.update(enable_caching=True, enable_ai=True, enable_fallback=True)
        self._provider(name="Gemini")
        calls = {"n": 0}

        def fake_adapter(provider):
            def generate(*a, **kw):
                calls["n"] += 1
                return "cached answer", 5, 5

            return SimpleAdapter(generate)

        mock_adapter.side_effect = fake_adapter
        AIService.generate(
            task="STUDENT_CHAT", system_prompt="s", user_text="same q",
            user=self.student, cacheable=True,
        )
        AIService.generate(
            task="STUDENT_CHAT", system_prompt="s", user_text="same q",
            user=self.student, cacheable=True,
        )
        self.assertEqual(calls["n"], 1)

    @patch("apps.placements.ai_router.adapter_for")
    def test_ai_disabled_raises(self, mock_adapter):
        AISettings.get()
        AISettings.objects.update(enable_ai=False)
        self._provider(name="Gemini")
        with self.assertRaises(AIServiceUnavailable):
            AIService.generate(
                task="STUDENT_CHAT", system_prompt="s", user_text="q",
                user=self.student, cacheable=False,
            )
        self.assertEqual(AIRequestLog.objects.count(), 0)

    def test_settings_endpoint(self):
        client = self._client(self.admin)
        resp = client.patch(
            "/api/admin/ai/settings/",
            {"enable_ai": False, "enable_fallback": False},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["enable_ai"])
        settings = AISettings.get()
        self.assertFalse(settings.enable_ai)
        self.assertFalse(settings.enable_fallback)

    def test_legacy_router_disabled_when_no_providers(self):
        # No providers configured -> the router raises instead of calling anyone.
        from .ai_router import _task_chain

        self.assertEqual(_task_chain("STUDENT_CHAT"), [])
