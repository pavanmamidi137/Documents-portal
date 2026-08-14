"""Super Admin portfolio endpoints.

All management endpoints are Super Admin only and operate on the caller's own
portfolio (one per admin). The public endpoint (``/api/portfolio/public/<slug>/``)
is reachable by anyone - logged in or not - and only ever returns the
published portfolio content, never the private AI reviews or the resume.

GET    /api/portfolio/                 -> my portfolio (created on demand)
PATCH  /api/portfolio/                 -> edit content / publish toggle
POST   /api/portfolio/upload-resume/   -> upload (or replace) my resume
POST   /api/portfolio/analyze/         -> run the AI review + content generation
POST   /api/portfolio/rebuild/         -> AI rewrite + .docx + again-review
POST   /api/portfolio/regenerate-slug/ -> new public link
DELETE /api/portfolio/resume/          -> remove my resume + rebuilt .docx
GET    /api/portfolio/public/<slug>/   -> public portfolio (no auth)
"""

from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsSuperAdmin
from apps.core.throttles import AiRateThrottle
from apps.core.utils import log_audit

from .models import Portfolio
from .portfolio_services import (
    analyze_portfolio,
    delete_portfolio_resume,
    generate_portfolio_slug,
    rebuild_resume,
    upload_portfolio_resume,
)
from .serializers import PortfolioSerializer, PublicPortfolioSerializer


def _get_own_portfolio(user) -> Portfolio:
    """The caller's portfolio, created on first access."""
    portfolio, _ = Portfolio.objects.get_or_create(user=user)
    if not portfolio.slug:
        portfolio.slug = generate_portfolio_slug(user)
        portfolio.save(update_fields=["slug", "updated_at"])
    return portfolio


class PortfolioView(APIView):
    permission_classes = [IsSuperAdmin]

    def get(self, request):
        return Response(PortfolioSerializer(_get_own_portfolio(request.user)).data)

    def patch(self, request):
        portfolio = _get_own_portfolio(request.user)
        def _clean_custom_sections(value):
            """Coerce to [{title, content}] (max 10 sections). None => invalid."""
            if not isinstance(value, list):
                return None
            out: list[dict] = []
            for item in value:
                if not isinstance(item, dict):
                    return None
                title = str(item.get("title") or "").strip()[:120]
                content = str(item.get("content") or "").strip()[:4000]
                if title or content:
                    out.append({"title": title, "content": content})
                if len(out) >= 10:
                    break
            return out

        editable = {
            "headline": (lambda v: str(v).strip()[:200]),
            "about": (lambda v: str(v).strip()),
            "skills": (lambda v: [str(s).strip() for s in v if str(s).strip()] if isinstance(v, list) else None),
            "education": (lambda v: str(v).strip()),
            "experience": (lambda v: str(v).strip()),
            "projects": (lambda v: str(v).strip()),
            "custom_sections": _clean_custom_sections,
            "is_published": (lambda v: bool(v)),
            "show_contact": (lambda v: bool(v)),
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


class PortfolioRegenerateSlugView(APIView):
    permission_classes = [IsSuperAdmin]

    def post(self, request):
        portfolio = _get_own_portfolio(request.user)
        portfolio.slug = generate_portfolio_slug(request.user)
        portfolio.save(update_fields=["slug", "updated_at"])
        log_audit(
            request.user, "PORTFOLIO_SLUG_REGENERATE", "Portfolio", portfolio.id,
            {}, request,
        )
        return Response(PortfolioSerializer(portfolio).data)


class PublicPortfolioView(APIView):
    """The shareable portfolio - visible to everyone, no login required.

    Only returns the published portfolio content. When the portfolio is
    unpublished, missing, or the slug is unknown, we return 404 so the link
    behaves like a normal "page not found".
    """

    permission_classes = [AllowAny]
    authentication_classes = []  # never requires a token

    def get(self, request, slug):
        portfolio = (
            Portfolio.objects.select_related("user")
            .filter(slug=slug, is_published=True)
            .first()
        )
        if not portfolio:
            raise NotFound("Portfolio not found or not published.")
        return Response(PublicPortfolioSerializer(portfolio).data)
