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

from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsSuperAdmin
from apps.core.throttles import AiRateThrottle
from apps.core.utils import log_audit

from .models import Portfolio
from .portfolio_services import (
    analyze_portfolio,
    delete_portfolio_resume,
    rebuild_resume,
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
    """Run the private AI review of the uploaded resume."""

    permission_classes = [IsSuperAdmin]
    throttle_classes = [AiRateThrottle]

    def post(self, request):
        from apps.placements.ai import AiError

        portfolio = _get_own_portfolio(request.user)
        if not portfolio.public_id or portfolio.is_missing:
            raise ValidationError({"detail": "Upload your resume first."})
        try:
            analyze_portfolio(portfolio, request.user)
        except AiError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(PortfolioSerializer(portfolio).data)


class PortfolioRebuildView(APIView):
    """The AI rebuild (.docx/.pdf/.tex) - a Super Admin premium tool."""

    permission_classes = [IsSuperAdmin]
    throttle_classes = [AiRateThrottle]

    def post(self, request):
        from apps.placements.ai import AiError

        portfolio = _get_own_portfolio(request.user)
        if not portfolio.public_id or portfolio.is_missing:
            raise ValidationError({"detail": "Upload your resume first."})
        try:
            rebuild_resume(portfolio, request.user)
        except AiError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(PortfolioSerializer(portfolio).data)


class PortfolioResumeDeleteView(APIView):
    permission_classes = [IsSuperAdmin]

    def delete(self, request):
        portfolio = _get_own_portfolio(request.user)
        if not portfolio.public_id:
            raise NotFound("No resume uploaded yet.")
        delete_portfolio_resume(portfolio, request.user, request)
        return Response(PortfolioSerializer(portfolio).data)
