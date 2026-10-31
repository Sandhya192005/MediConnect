from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point
from django.contrib.gis.measure import D
from django.db.models import Count, Q

from .models import Hospital


def nearby_hospitals(lat: float, lng: float, radius_km: float = 10, limit: int = 20, department: int | None = None):
    """
    Approved hospitals within radius_km of (lat, lng), nearest first.
    PostGIS: ST_DWithin (inside the radius, uses the spatial index) + ST_Distance (sort).
    Callers must validate inputs (lat −90..90, lng −180..180, radius 0.5–50, limit ≤ 50).
    """
    here = Point(lng, lat, srid=4326)  # PostGIS order: (longitude, latitude)
    qs = (
        Hospital.objects.filter(is_approved=True, location__dwithin=(here, D(km=radius_km)))
        .annotate(
            distance=Distance("location", here),
            doctor_count=Count("doctors", filter=Q(doctors__is_active=True), distinct=True),
        )
        .prefetch_related("departments")
        .order_by("distance")
    )
    if department:
        qs = qs.filter(departments__id=department)
    return qs[:limit]
