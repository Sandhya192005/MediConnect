from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point
from django.contrib.gis.measure import D
from django.db.models import Count, Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import ReadOnlyOrAdmin

from .models import Department, Hospital
from .serializers import DepartmentSerializer, HospitalSerializer, NearbyHospitalSerializer, NearbyQuerySerializer


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
        """
        GET /api/hospitals/nearby/?lat=13.06&lng=80.25&radius_km=10&limit=20&department=
        PostGIS does the work: ST_DWithin (inside the radius, uses the spatial index)
        and ST_Distance (sort nearest first). Distances are real metres on the Earth.
        """
        params = NearbyQuerySerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        p = params.validated_data
        here = Point(p["lng"], p["lat"], srid=4326)  # PostGIS order: (longitude, latitude)

        qs = (
            Hospital.objects.filter(is_approved=True, location__dwithin=(here, D(km=p["radius_km"])))
            .annotate(
                distance=Distance("location", here),
                doctor_count=Count("doctors", filter=Q(doctors__is_active=True), distinct=True),
            )
            .prefetch_related("departments")
            .order_by("distance")
        )
        if "department" in p:
            qs = qs.filter(departments__id=p["department"])

        results = NearbyHospitalSerializer(qs[: p["limit"]], many=True).data
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
