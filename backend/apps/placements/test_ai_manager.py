"""Tests for the AI Provider Manager and AI Router."""

from unittest.mock import patch

from openai import RateLimitError
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
from .ai_router import AIUnreadableResponse, AIService, AIServiceUnavailable


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
    def test_bad_json_fails_over_to_next_provider(self, mock_adapter):
        """A provider that answers with non-JSON for a JSON task is treated as
        a failure - the router moves on to the next provider instead of
        returning the unreadable output (the resume 'unreadable report' bug)."""
        primary = self._provider(name="Gemini", priority=1)
        fallback = self._provider(name="Groq", priority=2, provider_type="GROQ")
        AISettings.get()
        AISettings.objects.update(enable_caching=False)

        def fake_adapter(provider):
            def generate(*a, **kw):
                if provider.pk == primary.pk:
                    return "This is prose, not JSON", 10, 5
                return '{"score": 82, "summary": "great"}', 20, 8

            return SimpleAdapter(generate)

        mock_adapter.side_effect = fake_adapter
        result = AIService.generate(
            task="RESUME_ANALYSIS", system_prompt="sys", user_text="resume",
            user=self.student, cacheable=False, raw_json=True,
        )
        self.assertEqual(result, {"score": 82, "summary": "great"})
        # The unreadable reply was recorded as a failure + fallback.
        failed = AIRequestLog.objects.filter(status="FAILED")
        self.assertEqual(failed.count(), 1)
        self.assertEqual(failed.first().error_type, "UNREADABLE")
        log = AIRequestLog.objects.latest("id")
        self.assertTrue(log.fallback_used)
        self.assertEqual(log.provider_used, "Groq")
        self.assertEqual(log.primary_provider, "Gemini")
        # The bad provider's health degraded instead of staying healthy.
        primary.health_row.refresh_from_db()
        self.assertIn(
            primary.health_row.status, ("DEGRADED", "RATE_LIMITED", "UNAVAILABLE")
        )

    @patch("apps.placements.ai_router.adapter_for")
    def test_bad_json_never_cached(self, mock_adapter):
        """Garbage JSON must not be cached - a bad reply must not be served to
        other students for the cache TTL."""
        self._provider(name="Gemini")
        AISettings.get()
        AISettings.objects.update(enable_caching=True, enable_ai=True)
        calls = {"n": 0}

        def fake_adapter(provider):
            def generate(*a, **kw):
                calls["n"] += 1
                return "garbage", 5, 5

            return SimpleAdapter(generate)

        mock_adapter.side_effect = fake_adapter
        # No env NVIDIA key available to the safety net in this test.
        with patch("apps.placements.ai.env_json_fallback", return_value={}):
            # First call: bad JSON -> every provider tried -> unreadable error.
            with self.assertRaises(AIUnreadableResponse):
                AIService.generate(
                    task="RESUME_ANALYSIS", system_prompt="s", user_text="q",
                    user=self.student, cacheable=True, raw_json=True,
                )
            # Second call with the same inputs must hit the provider again (no
            # stale garbage served from cache).
            with self.assertRaises(AIUnreadableResponse):
                AIService.generate(
                    task="RESUME_ANALYSIS", system_prompt="s", user_text="q",
                    user=self.student, cacheable=True, raw_json=True,
                )
        self.assertEqual(calls["n"], 2)

    def test_ai_json_returns_empty_when_all_providers_unreadable(self):
        """ai_json returns {} (not an exception) when every provider answers
        with unreadable output - the resume analyzer then marks the attempt
        FAILED without charging credits."""
        from .ai import ai_json

        self._provider(name="Gemini")
        AISettings.get()
        AISettings.objects.update(enable_caching=False)

        with (
            patch(
                "apps.placements.ai_router.adapter_for"
            ) as mock_adapter,
            patch("apps.placements.ai.env_json_fallback", return_value={}),
        ):
            def fake_adapter(provider):
                def generate(*a, **kw):
                    return "Sorry, I cannot return JSON.", 5, 5

                return SimpleAdapter(generate)

            mock_adapter.side_effect = fake_adapter
            result = ai_json("sys", "resume text", task="RESUME_ANALYSIS")
        self.assertEqual(result, {})

    def test_ai_json_returns_parsed_dict_from_router(self):
        """ai_json passes through the router's parsed dict when the provider
        returns valid JSON."""
        from .ai import ai_json

        self._provider(name="Gemini")
        AISettings.get()
        AISettings.objects.update(enable_caching=False)

        with patch(
            "apps.placements.ai_router.adapter_for"
        ) as mock_adapter:
            def fake_adapter(provider):
                def generate(*a, **kw):
                    return '{"score": 91, "summary": "excellent"}', 5, 5

                return SimpleAdapter(generate)

            mock_adapter.side_effect = fake_adapter
            result = ai_json("sys", "resume text", task="RESUME_ANALYSIS")
        self.assertEqual(result, {"score": 91, "summary": "excellent"})

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
        # No env NVIDIA key available to the safety net in this test.
        with patch("apps.placements.ai.env_json_fallback", return_value={}):
            with self.assertRaises(AIServiceUnavailable):
                AIService.generate(
                    task="STUDENT_CHAT", system_prompt="sys", user_text="hello",
                    user=self.student, cacheable=False,
                )
        self.assertEqual(AIRequestLog.objects.filter(status="FAILED").count(), 2)

    def test_env_fallback_rescues_unreadable_provider(self):
        """When every configured provider returns unreadable JSON, the router
        falls back to the legacy NVIDIA_API_KEY client (30B chat model) so
        resume analysis still works even with a misconfigured admin-page
        provider/model."""
        self._provider(name="Gemini")
        AISettings.get()
        AISettings.objects.update(enable_caching=False)

        collected = []
        with (
            patch("apps.placements.ai_router.adapter_for") as mock_adapter,
            patch(
                "apps.placements.ai.env_json_fallback",
                return_value={"score": 77, "summary": "rescued"},
            ) as mock_env,
        ):
            def fake_adapter(provider):
                def generate(*a, **kw):
                    return "I cannot return JSON.", 5, 5

                return SimpleAdapter(generate)

            mock_adapter.side_effect = fake_adapter
            result = AIService.generate(
                task="RESUME_ANALYSIS", system_prompt="s", user_text="resume",
                user=self.student, cacheable=False, raw_json=True,
                usage_callback=lambda pt, ct: collected.append((pt, ct)),
            )
        self.assertEqual(result, {"score": 77, "summary": "rescued"})
        # The usage callback is forwarded so rescued runs still count against
        # the student's daily AI quota and AI usage.
        self.assertTrue(
            mock_env.call_args.kwargs.get("usage_callback") is not None
        )
        log = AIRequestLog.objects.latest("id")
        self.assertEqual(log.provider_used, "env-NVIDIA")
        self.assertEqual(log.error_type, "ENV_FALLBACK")
        self.assertTrue(log.fallback_used)

    def test_env_fallback_never_fires_for_images(self):
        """Image-bearing OCR calls must not hit the env fallback (the legacy
        client can't read images) - the provider response is used directly."""
        self._provider(name="Gemini")
        AISettings.get()
        AISettings.objects.update(enable_caching=False)

        with (
            patch("apps.placements.ai_router.adapter_for") as mock_adapter,
            patch("apps.placements.ai.env_json_fallback") as mock_env,
        ):
            def fake_adapter(provider):
                def generate(*a, **kw):
                    return "NO TEXT", 5, 5

                return SimpleAdapter(generate)

            mock_adapter.side_effect = fake_adapter
            result = AIService.generate(
                task="RESUME_OCR", system_prompt="s", user_text="ocr",
                images=["data:image/png;base64,AAAA"], user=self.student,
                cacheable=False,
            )
        self.assertEqual(result, "NO TEXT")
        mock_env.assert_not_called()

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


class AiMultiKeyFailoverTests(AiManagerBase):
    """Automatic key rotation when a provider key is rate-limited or invalid."""

    def test_env_keys_for_parses_comma_separated_and_numbered(self):
        import os

        from .ai_models import env_keys_for

        old = {
            k: os.environ.get(k)
            for k in ("GEMINI_API_KEY", "GEMINI_API_KEY_2", "NVIDIA_API_KEY")
        }
        os.environ["GEMINI_API_KEY"] = "g1, g2"
        os.environ["GEMINI_API_KEY_2"] = "g3"
        os.environ.pop("NVIDIA_API_KEY", None)
        try:
            self.assertEqual(
                env_keys_for(AIProvider.ProviderType.GEMINI), ["g1", "g2", "g3"]
            )
            self.assertEqual(env_keys_for(AIProvider.ProviderType.NVIDIA), [])
        finally:
            for key, value in old.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_provider_key_chain_primary_extra_and_env(self):
        import os

        from .ai_models import AIProviderKey, provider_key_chain

        provider = self._provider(name="Gemini")
        extra = AIProviderKey(provider=provider, note="backup")
        extra.set_api_key("backup-key-abc")
        extra.save()
        old = os.environ.get("GEMINI_API_KEY")
        os.environ["GEMINI_API_KEY"] = "env-key-xyz"
        try:
            chain = provider_key_chain(provider)
        finally:
            if old is None:
                os.environ.pop("GEMINI_API_KEY", None)
            else:
                os.environ["GEMINI_API_KEY"] = old
        # Stored primary first, then the extra key, then the env key - no dups.
        self.assertEqual(chain, ["sk-test-abcdef-1234", "backup-key-abc", "env-key-xyz"])

    @patch("apps.placements.ai_models.provider_key_chain")
    def test_openai_adapter_rotates_to_second_key_on_rate_limit(self, mock_chain):
        """A rate-limited first key automatically moves to the second key."""
        from .ai_adapters import OpenAICompatAdapter

        provider = self._provider(name="Groq", provider_type="GROQ")
        mock_chain.return_value = ["key-one", "key-two"]

        seen_keys = []

        class FakeCompletions:
            def __init__(self, client):
                self.client = client

            def create(self, **kwargs):
                seen_keys.append(self.client.api_key)
                if self.client.api_key == "key-one":
                    raise _FakeSDKRateLimit()
                from types import SimpleNamespace

                return SimpleNamespace(
                    choices=[
                        SimpleNamespace(
                            message=SimpleNamespace(content="answer from key two")
                        )
                    ],
                    usage=SimpleNamespace(prompt_tokens=5, completion_tokens=5),
                )

        class FakeChat:
            def __init__(self, client):
                self.completions = FakeCompletions(client)

        class FakeClient:
            def __init__(self, **kwargs):
                self.api_key = kwargs["api_key"]
                self.chat = FakeChat(self)

        with patch("openai.OpenAI", side_effect=FakeClient):
            text, pt, ct = OpenAICompatAdapter(provider).generate("sys", "user", 50)

        self.assertEqual(text, "answer from key two")
        self.assertEqual(seen_keys, ["key-one", "key-two"])

    @patch("apps.placements.ai_models.provider_key_chain")
    def test_gemini_adapter_retries_without_mime_type_when_rejected(self, mock_chain):
        """A Gemini model that rejects responseMimeType retries once as a
        plain completion instead of failing the whole call (mirrors the
        OpenAI-compat response_format fallback)."""
        import io
        import json
        from urllib.error import HTTPError

        from .ai_adapters import GeminiAdapter

        provider = self._provider(name="Gemini")
        mock_chain.return_value = ["gkey"]

        captured = []

        def fake_urlopen(req, timeout=60):
            captured.append(json.loads(req.data.decode("utf-8")))
            if len(captured) == 1:
                raise HTTPError(
                    req.full_url, 400, "bad request", {},
                    io.BytesIO(b'{"error": {"message": "response_mime_type not supported"}}'),
                )
            body = json.dumps(
                {
                    "candidates": [{"content": {"parts": [{"text": "{\"score\": 55}"}]}}],
                    "usageMetadata": {"promptTokenCount": 2, "candidatesTokenCount": 1},
                }
            ).encode("utf-8")
            return _FakeHttpResponse(body)

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            text, _, _ = GeminiAdapter(provider).generate("sys", "user", 50, raw_json=True)

        self.assertIn("score", text)
        # The retried request dropped responseMimeType.
        self.assertEqual(len(captured), 2)
        self.assertNotIn("responseMimeType", captured[1]["generationConfig"])

    @patch("apps.placements.ai_models.provider_key_chain")
    def test_gemini_adapter_rotates_to_second_key_on_rate_limit(self, mock_chain):
        """Gemini 429 on the first key rotates to the next env/stored key."""
        import json
        from urllib.error import HTTPError

        from .ai_adapters import GeminiAdapter

        provider = self._provider(name="Gemini")
        mock_chain.return_value = ["gkey-one", "gkey-two"]

        seen_urls = []

        def fake_urlopen(req, timeout=60):
            seen_urls.append(req.full_url)
            if "gkey-one" in req.full_url:
                raise HTTPError(req.full_url, 429, "quota", {}, None)
            body = json.dumps(
                {
                    "candidates": [
                        {"content": {"parts": [{"text": "hello from gemini"}]}}
                    ],
                    "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 2},
                }
            ).encode("utf-8")
            return _FakeHttpResponse(body)

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            text, pt, ct = GeminiAdapter(provider).generate("sys", "user", 50)

        self.assertEqual(text, "hello from gemini")
        self.assertEqual(len(seen_urls), 2)
        self.assertIn("gkey-one", seen_urls[0])
        self.assertIn("gkey-two", seen_urls[1])


class AiVisionImageTests(AiManagerBase):
    """Vision-capable calls: base64 page images flow through the router to the
    adapter payloads used for OCR of scanned resume PDFs."""

    @patch("apps.placements.ai_models.provider_key_chain")
    def test_openai_adapter_sends_image_url_parts(self, mock_chain):
        from .ai_adapters import OpenAICompatAdapter

        provider = self._provider(name="Groq", provider_type="GROQ")
        mock_chain.return_value = ["sk-key"]

        captured = {}

        class FakeCompletions:
            def __init__(self, client):
                self.client = client

            def create(self, **kwargs):
                captured["messages"] = kwargs["messages"]
                from types import SimpleNamespace

                return SimpleNamespace(
                    choices=[
                        SimpleNamespace(message=SimpleNamespace(content="ok"))
                    ],
                    usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1),
                )

        class FakeChat:
            def __init__(self, client):
                self.completions = FakeCompletions(client)

        class FakeClient:
            def __init__(self, **kwargs):
                self.api_key = kwargs["api_key"]
                self.chat = FakeChat(self)

        with patch("openai.OpenAI", side_effect=FakeClient):
            OpenAICompatAdapter(provider).generate(
                "sys", "user", 50, images=["data:image/png;base64,AAAA"]
            )

        user_content = captured["messages"][1]["content"]
        self.assertIsInstance(user_content, list)
        self.assertEqual(user_content[0], {"type": "text", "text": "user"})
        self.assertEqual(
            user_content[1],
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
        )

    @patch("apps.placements.ai_models.provider_key_chain")
    def test_gemini_adapter_sends_inline_data_parts(self, mock_chain):
        import json

        from .ai_adapters import GeminiAdapter

        provider = self._provider(name="Gemini")
        mock_chain.return_value = ["gkey"]

        captured = {}

        def fake_urlopen(req, timeout=60):
            captured["body"] = json.loads(req.data.decode("utf-8"))
            body = json.dumps(
                {
                    "candidates": [{"content": {"parts": [{"text": "transcribed"}]}}],
                    "usageMetadata": {"promptTokenCount": 2, "candidatesTokenCount": 1},
                }
            ).encode("utf-8")
            return _FakeHttpResponse(body)

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            text, _, _ = GeminiAdapter(provider).generate(
                "sys", "user", 50, images=["data:image/png;base64,QUJD"]
            )

        self.assertEqual(text, "transcribed")
        parts = captured["body"]["contents"][0]["parts"]
        self.assertEqual(parts[0], {"text": "user"})
        self.assertEqual(
            parts[1]["inline_data"],
            {"mime_type": "image/png", "data": "QUJD"},
        )

    def test_ocr_blank_page_no_text_is_rejected(self):
        """OCR output of exactly 'NO TEXT' (or empty/symbols) counts as a
        failed read so a blank page never reaches the quality model."""
        from unittest.mock import Mock

        from apps.placements import resume_ai

        resume = Mock(file_name="resume.pdf")
        with (
            patch.object(
                resume_ai, "_download_resume_content", return_value=(b"%PDF-1.4", "")
            ),
            patch(
                "apps.core.ocr.pdf_to_page_images",
                return_value=["data:image/png;base64,x"],
            ),
            patch("apps.placements.ai_router.AIService") as mock_service,
        ):
            mock_service.generate.return_value = "NO TEXT"
            self.assertEqual(resume_ai._ocr_resume_pdf(resume), "")
            mock_service.generate.return_value = "  ...  "
            self.assertEqual(resume_ai._ocr_resume_pdf(resume), "")
            mock_service.generate.return_value = (
                "Pavan Kumar - Python Developer\nHyderabad"
            )
            self.assertIn("Pavan Kumar", resume_ai._ocr_resume_pdf(resume))

    @patch("apps.placements.ai_router.adapter_for")
    def test_router_forwards_images_and_never_caches(self, mock_adapter):
        AISettings.get()
        AISettings.objects.update(enable_caching=True, enable_ai=True)
        self._provider(name="Gemini")

        calls = []

        def fake_adapter(provider):
            def generate(*a, **kw):
                calls.append(kw)
                return "ocr text", 5, 5

            return SimpleAdapter(generate)

        mock_adapter.side_effect = fake_adapter
        for _ in range(2):
            AIService.generate(
                task="RESUME_OCR", system_prompt="sys", user_text="transcribe",
                images=["data:image/png;base64,AAAA"], user=self.student,
                cacheable=True,
            )
        # Image-bearing calls are never cached - both hit the provider.
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]["images"], ["data:image/png;base64,AAAA"])


class _FakeSDKRateLimit(RateLimitError):
    """RateLimitError without the SDK's constructor requirements."""

    def __init__(self):
        pass


class _FakeHttpResponse:
    def __init__(self, body):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self._body


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


class AiParseTests(AiManagerBase):
    """Robust JSON parsing + report/matches normalization (ai_parse.py).

    The resume analyzer must accept valid JSON, fenced JSON, prose-wrapped
    JSON, key aliases and wrapper objects - and reject genuinely unusable
    answers (missing every field) so the caller can mark the attempt FAILED
    without charging credits.
    """

    def test_valid_json_normalizes_report(self):
        from .ai_parse import normalize_resume_report

        raw = {
            "score": 78,
            "summary": "Solid resume",
            "pros": ["Python", "Git"],
            "cons": ["No metrics"],
            "improvements": ["Add metrics", "Add a projects section"],
            "skills": ["Python", "SQL"],
            "ats_keywords": ["Agile"],
        }
        report = normalize_resume_report(raw)
        self.assertEqual(report["score"], 78)
        self.assertEqual(report["summary"], "Solid resume")
        self.assertEqual(report["pros"], ["Python", "Git"])
        self.assertEqual(report["strengths"], ["Python", "Git"])
        self.assertEqual(report["cons"], ["No metrics"])
        self.assertEqual(report["improvements"], ["Add metrics", "Add a projects section"])
        self.assertEqual(report["skills"], ["Python", "SQL"])
        self.assertEqual(report["ats_keywords"], ["Agile"])

    def test_fenced_json_parses(self):
        from .ai_parse import extract_json_object, normalize_resume_report

        raw = "```json\n{\"score\": 85, \"summary\": \"Great\", \"skills\": [\"Java\"]}\n```"
        parsed = extract_json_object(raw)
        self.assertEqual(parsed["score"], 85)
        report = normalize_resume_report(parsed)
        self.assertEqual(report["score"], 85)
        self.assertIn("Java", report["skills"])

    def test_prose_wrapped_and_truncated_json_still_parses(self):
        from .ai_parse import extract_json_object

        # Model wrapped the JSON in a sentence.
        raw = (
            'Here is the analysis: {"score": 62, "summary": "Decent", "skills": ["C++"]}. '
            "Hope that helps!"
        )
        parsed = extract_json_object(raw)
        self.assertEqual(parsed["score"], 62)
        self.assertEqual(parsed["skills"], ["C++"])
        # Truncated output - the object is cut off mid-way.
        truncated = '{"score": 40, "summary": "cut off'
        self.assertEqual(extract_json_object(truncated), {})

    def test_missing_every_field_is_unusable(self):
        from .ai_parse import normalize_resume_report

        # A valid JSON object, but with none of the expected fields.
        self.assertIsNone(normalize_resume_report({"foo": "bar", "n": 1}))
        self.assertIsNone(normalize_resume_report({}))
        self.assertIsNone(normalize_resume_report("not even json"))

    def test_key_aliases_and_wrapper_are_normalized(self):
        from .ai_parse import normalize_resume_report

        # camelCase + sentence-case keys and a wrapper object.
        raw = {
            "report": {
                "OverallScore": "72",
                "Description": "Needs polish",
                "Positives": "Good projects, Clear formatting",
                "Weaknesses": "No metrics",
                "Technologies": ["React"],
            }
        }
        report = normalize_resume_report(raw)
        self.assertIsNotNone(report)
        self.assertEqual(report["score"], 72)
        self.assertEqual(report["summary"], "Needs polish")
        self.assertEqual(report["pros"], ["Good projects", "Clear formatting"])
        self.assertEqual(report["strengths"], ["Good projects", "Clear formatting"])
        self.assertEqual(report["cons"], ["No metrics"])
        # weaknesses-only responses still fill the complete action list.
        self.assertEqual(report["improvements"], ["No metrics"])
        self.assertEqual(report["skills"], ["React"])

    def test_old_report_without_pros_cons_is_backwards_compatible(self):
        """Reports stored before pros/cons existed still normalize - strengths
        become pros and improvements are unchanged."""
        from .ai_parse import normalize_resume_report

        old = {
            "score": 65,
            "summary": "Decent",
            "strengths": ["Python"],
            "improvements": ["Add metrics"],
            "skills": ["Python"],
            "ats_keywords": ["Git"],
        }
        report = normalize_resume_report(old)
        self.assertEqual(report["pros"], ["Python"])
        self.assertEqual(report["cons"], [])
        self.assertEqual(report["improvements"], ["Add metrics"])

    def test_matches_normalization(self):
        from .ai_parse import normalize_matches

        raw = {
            "matches": [
                {"drive_id": 3, "score": 90, "reason": "Perfect fit"},
                {"id": 7, "match_score": "45", "explanation": "Partial"},
                {"drive_id": "bad", "score": 50},
                "not-a-dict",
            ]
        }
        entries = normalize_matches(raw)
        self.assertEqual([e["drive_id"] for e in entries], [3, 7])
        self.assertEqual(entries[0]["score"], 90)
        self.assertEqual(entries[1]["score"], 45)
        self.assertEqual(entries[1]["reason"], "Partial")
        # Not-a-list responses normalize to [] instead of raising.
        self.assertEqual(normalize_matches({"matches": 42}), [])
        self.assertEqual(normalize_matches("nope"), [])

    def test_router_path_parses_fenced_json_from_provider(self):
        """ai_json through the router parses fenced/prose-wrapped JSON that a
        provider returns (the resume 'unreadable report' bug fix)."""
        from .ai import ai_json

        self._provider(name="Gemini")
        AISettings.get()
        AISettings.objects.update(enable_caching=False)

        with patch(
            "apps.placements.ai_router.adapter_for"
        ) as mock_adapter:
            def fake_adapter(provider):
                def generate(*a, **kw):
                    return (
                        "Sure! ```json\n{\"score\": 66, \"summary\": \"ok\"}\n```",
                        5,
                        5,
                    )

                return SimpleAdapter(generate)

            mock_adapter.side_effect = fake_adapter
            result = ai_json("sys", "resume", task="RESUME_ANALYSIS")
        self.assertEqual(result["score"], 66)

    def test_env_json_fallback_uses_env_key_and_parses(self):
        """env_json_fallback calls the env NVIDIA client (30B chat model) with
        the env key and parses fenced JSON - the router's last-resort safety
        net for resume analysis."""
        from types import SimpleNamespace

        from .ai import env_json_fallback

        captured = {}

        class FakeCompletions:
            def create(self, **kwargs):
                captured["kwargs"] = kwargs
                return SimpleNamespace(
                    choices=[
                        SimpleNamespace(
                            message=SimpleNamespace(
                                content='```json\n{"score": 58, "summary": "ok"}\n```'
                            )
                        )
                    ],
                    usage=SimpleNamespace(prompt_tokens=2, completion_tokens=2),
                )

        class FakeChat:
            def __init__(self, client):
                self.completions = FakeCompletions()

        class FakeClient:
            def __init__(self, **kwargs):
                self.api_key = kwargs["api_key"]
                self.chat = FakeChat(self)

        with (
            patch("apps.placements.ai.OpenAI", side_effect=FakeClient),
            patch("apps.placements.ai.get_api_keys", return_value=["env-key"]),
        ):
            result = env_json_fallback("sys", "resume", 200, raw_json=True)
        self.assertEqual(result["score"], 58)
        # It requested structured JSON from the 30B model.
        self.assertEqual(
            captured["kwargs"].get("response_format"), {"type": "json_object"}
        )
        # Without an env key it returns {} and never raises.
        with patch("apps.placements.ai.get_api_keys", return_value=[]):
            self.assertEqual(env_json_fallback("sys", "u", 200, raw_json=True), {})

    def test_legacy_env_path_requests_json_and_parses_fenced_output(self):
        """The env-key (no-provider) path asks for structured JSON and parses
        fenced output through the same robust parser."""
        from types import SimpleNamespace

        from .ai import ai_json

        # No providers configured -> the router is not used; the legacy
        # NVIDIA env-key path handles the call.
        self.assertEqual(AIProvider.objects.count(), 0)

        captured = {}

        class FakeCompletions:
            def __init__(self, client):
                self.client = client

            def create(self, **kwargs):
                captured["kwargs"] = kwargs
                return SimpleNamespace(
                    choices=[
                        SimpleNamespace(
                            message=SimpleNamespace(
                                content=(
                                    "Here you go: ```json\n"
                                    '{"score": 61, "summary": "ok"}\n```'
                                )
                            )
                        )
                    ],
                    usage=SimpleNamespace(prompt_tokens=4, completion_tokens=3),
                )

        class FakeChat:
            def __init__(self, client):
                self.completions = FakeCompletions(client)

        class FakeClient:
            def __init__(self, **kwargs):
                self.api_key = kwargs["api_key"]
                self.chat = FakeChat(self)

        # ai.py imports OpenAI at module level, so patch the module attribute.
        with (
            patch("apps.placements.ai.OpenAI", side_effect=FakeClient),
            patch("apps.placements.ai.get_api_keys", return_value=["test-key"]),
        ):
            result = ai_json("sys", "resume", task="RESUME_ANALYSIS")
        self.assertEqual(result["score"], 61)
        # The legacy path asks the endpoint for a structured JSON object.
        self.assertEqual(
            captured["kwargs"].get("response_format"), {"type": "json_object"}
        )


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
    def test_task_list_auto_creates_missing_task_rows(self):
        """The tasks endpoint seeds a row for every known task (incl. RESUME_OCR)
        so admins can route new AI work without re-deploying code."""
        client = self._client(self.admin)
        resp = client.get("/api/admin/ai/tasks/")
        self.assertEqual(resp.status_code, 200)
        tasks = {t["task"] for t in resp.data}
        self.assertIn("RESUME_OCR", tasks)
        self.assertEqual(len(tasks), len(AITaskConfiguration.Task.choices))
        self.assertTrue(
            AITaskConfiguration.objects.filter(
                task=AITaskConfiguration.Task.RESUME_OCR
            ).exists()
        )

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
