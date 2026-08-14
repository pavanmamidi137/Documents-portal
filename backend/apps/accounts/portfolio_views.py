"""Super Admin private AI resume workspace endpoints.

All endpoints are Super Admin only and operate on the caller's own workspace
(one per admin). Nothing here is public - the resume and both AI reviews are
private to the admin.

GET    /api/resume-workspace/                -> my workspace (created on demand)
PATCH  /api/resume-workspace/                -> save my LaTeX resume source
POST   /api/resume-workspace/upload-resume/  -> upload (or replace) my resume
POST   /api/resume-workspace/analyze/        -> run the private AI review
POST   /api/resume-workspace/rebuild/        -> AI rewrite + .docx/.pdf/.tex + again-review
DELETE /api/resume-workspace/resume/         -> remove my resume + rebuilt files
"""

import threading

from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsSuperAdmin
from apps.core.throttles import AiRateThrottle
from apps.core.utils import log_audit

from .models import Portfolio
from .portfolio_services import (
    _auto_analyze_in_thread,
    _rebuild_in_thread,
    delete_portfolio_resume,
    upload_portfolio_resume,
)
from .serializers import PortfolioSerializer


def _get_own_portfolio(user) -> Portfolio:
    """The caller's private resume workspace, created on first access."""
    portfolio, _ = Portfolio.objects.get_or_create(user=user)
    return portfolio


class PortfolioView(APIView):
    permission_classes = [IsSuperAdmin]

    def get(self, request):
        return Response(PortfolioSerializer(_get_own_portfolio(request.user)).data)

    def patch(self, request):
        portfolio = _get_own_portfolio(request.user)
        editable = {
            "resume_source": (lambda v: str(v).strip()[:20000]),
            "rebuild_requirements": (lambda v: str(v).strip()[:10000]),
        }
        changed: list[str] = []
        for field, clean in editable.items():
            if field not in request.data:
                continue
            value = clean(request.data[field])
            if value is None:
                raise ValidationError({field: "Invalid value for this field."})
            setattr(portfolio, field, value)
            changed.append(field)
        if not changed:
            raise ValidationError({"detail": "Nothing to update."})
        portfolio.save()
        log_audit(
            request.user, "PORTFOLIO_UPDATE", "Portfolio", portfolio.id,
            {"fields": changed}, request,
        )
        return Response(PortfolioSerializer(portfolio).data)


class PortfolioUploadResumeView(APIView):
    """Upload (or replace) the admin's own resume on Cloudinary."""

    permission_classes = [IsSuperAdmin]

    def post(self, request):
        resume_file = request.FILES.get("file")
        if not resume_file:
            raise ValidationError({"file": "A resume file is required."})
        portfolio = upload_portfolio_resume(
            _get_own_portfolio(request.user), resume_file, request
        )
        return Response(PortfolioSerializer(portfolio).data, status=status.HTTP_201_CREATED)


class PortfolioAnalyzeView(APIView):
    """Start the private AI review of the uploaded resume (runs in background).

    The review is a single LLM call that can take a minute or two - long
    enough to trip proxy/worker request timeouts. It runs off the request
    thread with ai_status=PENDING; the frontend polls until it settles.
    """

    permission_classes = [IsSuperAdmin]
    throttle_classes = [AiRateThrottle]

    def post(self, request):
        portfolio = _get_own_portfolio(request.user)
        if not portfolio.public_id or portfolio.is_missing:
            raise ValidationError({"detail": "Upload your resume first."})
        portfolio.ai_status = Portfolio.AiStatus.PENDING
        portfolio.ai_error = ""
        portfolio.save(update_fields=["ai_status", "ai_error", "updated_at"])
        try:
            threading.Thread(
                target=_auto_analyze_in_thread, args=(portfolio.id,), daemon=True
            ).start()
        except Exception:
            pass  # never fail the request because the thread failed to start
        return Response(PortfolioSerializer(portfolio).data)


class PortfolioRebuildView(APIView):
    """Start the AI rebuild (.docx/.pdf/.tex) - runs in the background.

    The rebuild makes several sequential LLM calls and can take minutes, so it
    runs off the request thread with rebuilt_ai_status=PENDING and the
    frontend polls until it settles.
    """

    permission_classes = [IsSuperAdmin]
    throttle_classes = [AiRateThrottle]

    def post(self, request):
        portfolio = _get_own_portfolio(request.user)
        if not portfolio.public_id or portfolio.is_missing:
            raise ValidationError({"detail": "Upload your resume first."})
        portfolio.rebuilt_ai_status = Portfolio.AiStatus.PENDING
        portfolio.rebuilt_ai_error = ""
        portfolio.rebuilt_ai_score = None
        portfolio.rebuilt_ai_analysis = None
        portfolio.save(update_fields=[
            "rebuilt_ai_status", "rebuilt_ai_error", "rebuilt_ai_score",
            "rebuilt_ai_analysis", "updated_at",
        ])
        try:
            threading.Thread(
                target=_rebuild_in_thread, args=(portfolio.id,), daemon=True
            ).start()
        except Exception:
            pass  # never fail the request because the thread failed to start
        return Response(PortfolioSerializer(portfolio).data)


class PortfolioResumeDeleteView(APIView):
    permission_classes = [IsSuperAdmin]

    def delete(self, request):
        portfolio = _get_own_portfolio(request.user)
        if not portfolio.public_id:
            raise NotFound("No resume uploaded yet.")
        delete_portfolio_resume(portfolio, request.user, request)
        return Response(PortfolioSerializer(portfolio).data)
