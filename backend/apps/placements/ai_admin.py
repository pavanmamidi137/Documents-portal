"""Super Admin-only API for the AI Provider Manager.

Endpoints (all require a Super Admin):
    GET/POST    /api/admin/ai/providers/
    GET/PATCH/DELETE /api/admin/ai/providers/{id}/
    POST        /api/admin/ai/providers/{id}/test/
    GET/PATCH   /api/admin/ai/tasks/{id}/
    GET/POST    /api/admin/ai/tasks/            (create a missing task config)
    GET/PATCH   /api/admin/ai/settings/
    GET         /api/admin/ai/health/
    GET         /api/admin/ai/usage/

API keys are ALWAYS masked in responses (********abcd). A key is only written
when the client sends a non-empty ``api_key`` field.
"""

from django.db.models import Count, Q as models_Q, Sum
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet, ViewSet

from apps.core.permissions import IsSuperAdmin
from apps.core.utils import log_audit

from .ai_adapters import RouterError
from .ai_models import (
    AIProvider,
    AIProviderHealth,
    AIProviderKey,
    AIRequestLog,
    AISettings,
    AITaskConfiguration,
)
from .ai_router import AIService


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------
class AIProviderSerializer(serializers.ModelSerializer):
    api_key = serializers.CharField(write_only=True, required=False, allow_blank=True)
    api_key_masked = serializers.CharField(read_only=True)
    health_label = serializers.CharField(source="get_health_display", read_only=True)
    provider_type_label = serializers.CharField(source="get_provider_type_display", read_only=True)
    # Additional (redundant) keys for the same provider - masked previews only.
    extra_keys = serializers.SerializerMethodField()

    class Meta:
        model = AIProvider
        fields = [
            "id", "name", "provider_type", "provider_type_label", "model", "base_url",
            "api_key", "api_key_masked", "extra_keys", "priority", "enabled",
            "timeout_seconds", "max_retries", "purpose", "health", "health_label",
            "last_success_at", "last_failure_at", "last_error_type",
            "consecutive_failures", "total_requests", "total_errors",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "health", "last_success_at", "last_failure_at", "last_error_type",
            "consecutive_failures", "total_requests", "total_errors",
            "created_at", "updated_at",
        ]

    def get_extra_keys(self, obj):
        return [
            {"id": k.id, "masked": k.api_key_masked, "note": k.note}
            for k in obj.keys.all()
        ]

    def create(self, validated_data):
        api_key = validated_data.pop("api_key", "")
        provider = AIProvider(**validated_data)
        try:
            provider.set_api_key(api_key)
        except ValueError as exc:
            raise serializers.ValidationError({"api_key": str(exc)})
        provider.save()
        return provider

    def update(self, instance, validated_data):
        api_key = validated_data.pop("api_key", "")
        if api_key:
            try:
                instance.set_api_key(api_key)
            except ValueError as exc:
                raise serializers.ValidationError({"api_key": str(exc)})
        return super().update(instance, validated_data)


class AITaskSerializer(serializers.ModelSerializer):
    task_label = serializers.CharField(source="get_task_display", read_only=True)
    primary_name = serializers.CharField(source="primary.name", read_only=True, default="")
    fallback_1_name = serializers.CharField(source="fallback_1.name", read_only=True, default="")
    fallback_2_name = serializers.CharField(source="fallback_2.name", read_only=True, default="")
    fallback_3_name = serializers.CharField(source="fallback_3.name", read_only=True, default="")

    class Meta:
        model = AITaskConfiguration
        fields = [
            "id", "task", "task_label", "primary", "primary_name",
            "fallback_1", "fallback_1_name", "fallback_2", "fallback_2_name",
            "fallback_3", "fallback_3_name", "updated_at",
        ]
        read_only_fields = ["updated_at"]


class AISettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = AISettings
        fields = [
            "enable_ai", "enable_fallback", "enable_caching", "enable_web_research",
            "default_timeout_seconds", "default_max_retries", "maintenance_mode",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]


class AIRequestLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    user_roll = serializers.CharField(source="user.roll_number", read_only=True, default="")
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = AIRequestLog
        fields = [
            "id", "provider_used", "primary_provider", "task", "user_name", "user_roll",
            "status", "status_label", "fallback_used", "error_type", "prompt_tokens",
            "completion_tokens", "latency_ms", "created_at",
        ]
        read_only_fields = fields

    def get_user_name(self, obj) -> str:
        return obj.user.full_name if obj.user else "System"


class AIProviderHealthSerializer(serializers.ModelSerializer):
    provider_name = serializers.CharField(source="provider.name", read_only=True)
    provider_type = serializers.CharField(source="provider.provider_type", read_only=True)

    class Meta:
        model = AIProviderHealth
        fields = [
            "id", "provider", "provider_name", "provider_type", "status",
            "last_success_at", "last_failure_at", "last_error_type",
            "failure_count", "success_count", "last_used_at", "updated_at",
        ]
        read_only_fields = fields


# ---------------------------------------------------------------------------
# Viewsets
# ---------------------------------------------------------------------------
class AIProviderViewSet(ModelViewSet):
    """Configure AI providers (Super Admin only)."""

    serializer_class = AIProviderSerializer
    permission_classes = [IsSuperAdmin]
    queryset = AIProvider.objects.prefetch_related("keys").all()

    def _log(self, action, provider, request, details=None):
        log_audit(
            request.user, action, "AIProvider", provider.id,
            {"name": provider.name, **(details or {})}, request,
        )

    def perform_create(self, serializer):
        provider = serializer.save()
        AIProviderHealth.objects.get_or_create(provider=provider)
        self._log("CREATE", provider, self.request)

    def perform_update(self, serializer):
        old = serializer.instance
        provider = serializer.save()
        self._log(
            "UPDATE", provider, self.request,
            {"model": provider.model, "enabled": provider.enabled,
             "priority": provider.priority, "was_enabled": old.enabled},
        )

    def perform_destroy(self, instance):
        self._log("DELETE", instance, self.request)
        instance.delete()

    @action(detail=True, methods=["post"])
    def add_key(self, request, pk=None):
        """Add an extra (redundant) API key for one provider."""
        provider = self.get_object()
        api_key = (request.data.get("api_key") or "").strip()
        note = (request.data.get("note") or "").strip()[:120]
        if not api_key:
            return Response({"detail": "An API key is required."}, status=400)
        key = AIProviderKey(provider=provider, note=note)
        try:
            key.set_api_key(api_key)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        key.save()
        return Response({"id": key.id, "masked": key.api_key_masked, "note": key.note}, status=201)

    @action(detail=True, methods=["post"])
    def remove_key(self, request, pk=None):
        """Remove one extra key by its id."""
        provider = self.get_object()
        try:
            key_id = int(request.data.get("key_id") or 0)
        except (TypeError, ValueError):
            return Response({"detail": "A valid key id is required."}, status=400)
        deleted, _ = provider.keys.filter(pk=key_id).delete()
        if not deleted:
            return Response({"detail": "Key not found."}, status=404)
        return Response(status=204)

    @action(detail=True, methods=["post"])
    def test(self, request, pk=None):
        """Run a tiny call against this provider and report health."""
        provider = self.get_object()
        try:
            AIService.test_provider(provider, timeout=15)
        except RouterError as exc:
            # Record the failure for the admin health page without leaking
            # internal details (API key, stack traces) to the response.
            AIProviderHealth.objects.update_or_create(
                provider=provider,
                defaults={
                    "status": "RATE_LIMITED" if "RATE" in exc.error_type else "UNAVAILABLE",
                    "last_failure_at": timezone.now(),
                    "last_error_type": exc.error_type,
                },
            )
            friendly = {
                "AUTH": "Invalid API key or expired credentials.",
                "NO_KEY": "No API key is configured for this provider.",
                "RATE_LIMITED": "The provider is rate limiting this key.",
                "TIMEOUT": "The provider did not respond in time.",
                "EMPTY_RESPONSE": "The provider returned an empty response.",
            }.get(exc.error_type, "The provider is unavailable right now.")
            return Response({"detail": friendly, "ok": False}, status=502)
        AIProviderHealth.objects.update_or_create(
            provider=provider,
            defaults={"status": "HEALTHY", "last_success_at": timezone.now()},
        )
        return Response({"detail": "Connection successful.", "ok": True})


class AITaskViewSet(ModelViewSet):
    """Per-task provider routing (Super Admin only)."""

    serializer_class = AITaskSerializer
    permission_classes = [IsSuperAdmin]
    # Small fixed list (one row per task) - no pagination wrapper.
    pagination_class = None
    queryset = AITaskConfiguration.objects.select_related(
        "primary", "fallback_1", "fallback_2", "fallback_3"
    ).all()
    http_method_names = ["get", "post", "patch"]

    def perform_create(self, serializer):
        config = serializer.save()
        log_audit(self.request.user, "CREATE", "AITaskConfiguration", config.id,
                  {"task": config.task}, self.request)

    def perform_update(self, serializer):
        config = serializer.save()
        log_audit(self.request.user, "UPDATE", "AITaskConfiguration", config.id,
                  {"task": config.task}, self.request)


class AISettingsView(APIView):
    """Global AI switches (Super Admin only).

    GET   /api/admin/ai/settings/
    PATCH /api/admin/ai/settings/
    """

    permission_classes = [IsSuperAdmin]

    def get(self, request):
        return Response(AISettingsSerializer(AISettings.get()).data)

    def patch(self, request):
        settings_obj = AISettings.get()
        serializer = AISettingsSerializer(settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        log_audit(request.user, "UPDATE", "AISettings", "1",
                  dict(request.data), request)
        return Response(serializer.data)


class AIHealthViewSet(ViewSet):
    """Provider health table (Super Admin only)."""

    permission_classes = [IsSuperAdmin]

    def list(self, request):
        rows = AIProviderHealth.objects.select_related("provider").all()
        return Response(AIProviderHealthSerializer(rows, many=True).data)


class AIUsageViewSet(ViewSet):
    """AI request log + aggregate stats (Super Admin only)."""

    permission_classes = [IsSuperAdmin]

    @action(detail=False, methods=["get"])
    def report(self, request):
        """Today's AI health snapshot for the Usage tab (no notification)."""
        from .ai_report import build_daily_report

        return Response(build_daily_report() or {"empty": True})

    @action(detail=False, methods=["post"])
    def send_report(self, request):
        """Send the AI health report notification to all admins right now."""
        from .ai_report import notify_admins_daily_report

        sent = notify_admins_daily_report()
        if sent:
            return Response({"detail": f"AI health report sent to {sent} admin(s)."})
        return Response(
            {"detail": "No AI activity in the last 24h - nothing to report."},
            status=200,
        )

    def list(self, request):
        logs = AIRequestLog.objects.select_related("user", "provider")
        total = logs.count()
        ok = logs.filter(status=AIRequestLog.Status.SUCCESS).count()
        errors = logs.filter(status=AIRequestLog.Status.FAILED).count()
        tokens = logs.aggregate(
            prompt=Sum("prompt_tokens"), completion=Sum("completion_tokens"),
        )
        by_provider = list(
            logs.values("provider_used")
            .annotate(calls=Count("id"), errors=Count("id", filter=models_Q(status="FAILED")))
            .order_by("-calls")
        )
        recent = AIRequestLogSerializer(logs[:50], many=True).data
        return Response({
            "totals": {
                "calls": total,
                "success": ok,
                "errors": errors,
                "prompt_tokens": int(tokens["prompt"] or 0),
                "completion_tokens": int(tokens["completion"] or 0),
                "fallback_used": logs.filter(fallback_used=True).count(),
            },
            "by_provider": by_provider,
            "recent": recent,
        })
