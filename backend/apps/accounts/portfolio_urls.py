from django.urls import path

from .portfolio_views import (
    PortfolioAnalyzeView,
    PortfolioRebuildView,
    PortfolioResumeDeleteView,
    PortfolioUploadResumeView,
    PortfolioView,
)

urlpatterns = [
    path("", PortfolioView.as_view(), name="portfolio"),
    path("upload-resume/", PortfolioUploadResumeView.as_view(), name="portfolio-upload-resume"),
    path("analyze/", PortfolioAnalyzeView.as_view(), name="portfolio-analyze"),
    path("rebuild/", PortfolioRebuildView.as_view(), name="portfolio-rebuild"),
    path("resume/", PortfolioResumeDeleteView.as_view(), name="portfolio-resume-delete"),
]
