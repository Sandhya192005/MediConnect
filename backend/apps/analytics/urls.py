from django.urls import path

from .views import PlatformOverviewView, PlatformReportsView

urlpatterns = [
    path("overview/", PlatformOverviewView.as_view(), name="platform-overview"),
    path("reports/", PlatformReportsView.as_view(), name="platform-reports"),
]
