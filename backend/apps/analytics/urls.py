from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.hospitals.connections import ConnectionRequestViewSet

from .views import PlatformOverviewView, PlatformReportsView

router = SimpleRouter()
router.register("connection-requests", ConnectionRequestViewSet, basename="connection-request")

urlpatterns = [
    path("overview/", PlatformOverviewView.as_view(), name="platform-overview"),
    path("reports/", PlatformReportsView.as_view(), name="platform-reports"),
    *router.urls,
]
