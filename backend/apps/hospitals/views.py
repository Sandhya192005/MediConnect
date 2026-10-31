from django.db.models import Count
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import ReadOnlyOrAdmin

from .models import Department, Hospital
from .serializers import DepartmentSerializer, HospitalSerializer, NearbyHospitalSerializer, NearbyQuerySerializer
from .services import nearby_hospitals


class DepartmentViewSet(viewsets.ModelViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    permission_classes = [ReadOnlyOrAdmin]
    pagination_class = None


class HospitalViewSet(viewsets.ModelViewSet):
    serializer_class = HospitalSerializer
    permission_classes = [ReadOnlyOrAdmin]

    def get_queryset(self):
        qs = Hospital.objects.prefetch_related("departments")
        # Admins also see hospitals that are waiting for approval.
        user = self.request.user
        if not (user.is_authenticated and user.role == "admin"):
            qs = qs.filter(is_approved=True)
        if city := self.request.query_params.get("city"):
            qs = qs.filter(city__iexact=city)
        if dept := self.request.query_params.get("department"):
            qs = qs.filter(departments__id=dept)
        return qs.distinct()

    @action(detail=False)
    def nearby(self, request):
        """GET /api/hospitals/nearby/?lat=13.06&lng=80.25&radius_km=10&limit=20&department="""
        params = NearbyQuerySerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        p = params.validated_data
        qs = nearby_hospitals(p["lat"], p["lng"], p["radius_km"], p["limit"], p.get("department"))
        results = NearbyHospitalSerializer(qs, many=True).data
        return Response({
            "center": {"lat": p["lat"], "lng": p["lng"]},
            "radius_km": p["radius_km"],
            "count": len(results),
            "results": results,
        })

    @action(detail=False)
    def cities(self, request):
        """Cities with approved hospitals, so patients can browse without sharing location."""
        rows = (
            Hospital.objects.filter(is_approved=True)
            .values("city")
            .annotate(hospitals=Count("id"))
            .order_by("city")
        )
        return Response(list(rows))
