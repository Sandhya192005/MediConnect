from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point
from django.contrib.gis.measure import D
from django.db.models import BooleanField, Count, Exists, ExpressionWrapper, OuterRef, Q

from .models import Hospital


def listed_hospitals():
    """
    Hospitals patients can see: partners plus OpenStreetMap / website-collected ones.
    `partner` = approved and has a MediConnect doctor with working hours (instant booking).
    """
    from apps.doctors.models import DoctorProfile

    bookable = DoctorProfile.objects.filter(hospital=OuterRef("pk"), is_active=True, availability__isnull=False)
    return (
        Hospital.objects.filter(Q(is_approved=True) | Q(source__in=[Hospital.Source.OSM, Hospital.Source.SCRAPED]))
        .annotate(has_bookable=Exists(bookable))
        .annotate(partner=ExpressionWrapper(Q(is_approved=True, has_bookable=True), output_field=BooleanField()))
    )


def nearby_hospitals(lat: float, lng: float, radius_km: float = 10, limit: int = 20,
                     department: int | None = None, partners_only: bool = False):
    """
    Hospitals within radius_km of (lat, lng), nearest first.
    PostGIS: ST_DWithin (inside the radius, uses the spatial index) + ST_Distance (sort).
    Callers must validate inputs (lat −90..90, lng −180..180, radius 0.5–50, limit ≤ 100).
    """
    here = Point(lng, lat, srid=4326)  # PostGIS order: (longitude, latitude)
    qs = listed_hospitals().filter(location__dwithin=(here, D(km=radius_km)))
    if partners_only:
        qs = qs.filter(partner=True)
    if department:
        qs = qs.filter(departments__id=department)
    return (
        qs.annotate(
            distance=Distance("location", here),
            doctor_count=Count("doctors", filter=Q(doctors__is_active=True), distinct=True),
        )
        .prefetch_related("departments")
        .order_by("distance")[:limit]
    )
