from django.urls import path

from .portfolio_views import (
    PortfolioAnalyzeView,
    PortfolioImageUploadView,
    PortfolioRebuildView,
    PortfolioRegenerateSlugView,
    PortfolioResumeDeleteView,
    PortfolioUploadResumeView,
    PortfolioView,
    PublicPortfolioView,
)

urlpatterns = [
    path("", PortfolioView.as_view(), name="portfolio"),
    path("upload-resume/", PortfolioUploadResumeView.as_view(), name="portfolio-upload-resume"),
    path("upload-image/", PortfolioImageUploadView.as_view(), name="portfolio-upload-image"),
    path("analyze/", PortfolioAnalyzeView.as_view(), name="portfolio-analyze"),
    path("rebuild/", PortfolioRebuildView.as_view(), name="portfolio-rebuild"),
    path("regenerate-slug/", PortfolioRegenerateSlugView.as_view(), name="portfolio-regenerate-slug"),
    path("resume/", PortfolioResumeDeleteView.as_view(), name="portfolio-resume-delete"),
    path("public/<str:slug>/", PublicPortfolioView.as_view(), name="portfolio-public"),
]
