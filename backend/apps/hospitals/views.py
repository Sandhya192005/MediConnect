from django.db.models import Count
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import ReadOnlyOrAdmin

from .models import Department, Hospital
from .serializers import (
    CitySearchSerializer,
    DepartmentSerializer,
    HospitalSerializer,
    NearbyHospitalSerializer,
    NearbyQuerySerializer,
)
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
        return Response(self._nearby_response(p["lat"], p["lng"], p))

    @action(detail=False, url_path="city")
    def city(self, request):
        """GET /api/hospitals/city/?name=Chennai — all hospitals around a city's centre, no patient location needed."""
        from apps.scraper.geocode import find_place

        params = CitySearchSerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        p = params.validated_data
        try:
            place = find_place(p["name"])
        except Exception:
            return Response({"detail": "Map search is busy. Please try again in a minute."}, status=503)
        if not place:
            return Response({"detail": f"We couldn't find a place called “{p['name']}”. Check the spelling."}, status=404)
        data = self._nearby_response(place["lat"], place["lng"], p)
        data["place"] = place
        return Response(data)

    def _nearby_response(self, lat, lng, p):
        from apps.scraper.directory import ensure_tiles

        # Start background downloads of any map squares we haven't refreshed in 24 h.
        loading = ensure_tiles(lat, lng, p["radius_km"]) if not p.get("partners_only") else False
        qs = nearby_hospitals(lat, lng, p["radius_km"], p["limit"], p.get("department"), p.get("partners_only", False))
        results = NearbyHospitalSerializer(qs, many=True).data
        return {
            "center": {"lat": lat, "lng": lng},
            "radius_km": p["radius_km"],
            "count": len(results),
            "loading_more": loading,  # True: more hospitals are being fetched from OpenStreetMap
            "results": results,
        }

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
