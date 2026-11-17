from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsPlatformAdmin

from . import services


class PlatformOverviewView(APIView):
    """GET /api/platform/overview/ — totals with growth, monthly active users (6 months), recent activity."""

    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        return Response(services.overview())


class PlatformReportsView(APIView):
    """GET /api/platform/reports/?months=12 (3–24) — monthly usage, hospital growth and the hospital table."""

    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        try:
            months = min(24, max(3, int(request.query_params.get("months", 12))))
        except ValueError:
            months = 12
        return Response(services.reports(months))
