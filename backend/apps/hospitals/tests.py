import pytest
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from rest_framework.test import APIClient

from .models import Hospital

User = get_user_model()

# Reference point: Chennai Central (lat 13.0827, lng 80.2707)
LAT, LNG = 13.0827, 80.2707


@pytest.fixture
def hospitals(db):
    def make(name, lat=None, lng=None, city="Chennai", **kw):
        loc = Point(lng, lat, srid=4326) if lat is not None else None
        return Hospital.objects.create(name=name, city=city, location=loc, **kw)

    return {
        "near": make("Near Hospital", 13.0850, 80.2750),          # ~0.5 km
        "mid": make("Mid Hospital", 13.0418, 80.2341),            # ~6 km
        "far": make("Far Hospital", 12.9165, 79.1325, city="Vellore"),  # ~125 km
        "no_location": make("No Pin Hospital"),
        "unapproved": make("Pending Hospital", 13.0830, 80.2710, is_approved=False),
    }


def nearby(**params):
    return APIClient().get("/api/hospitals/nearby/", params)


def test_nearby_sorted_by_distance_within_radius(hospitals):
    res = nearby(lat=LAT, lng=LNG, radius_km=10)
    assert res.status_code == 200
    names = [h["name"] for h in res.data["results"]]
    assert names == ["Near Hospital", "Mid Hospital"]  # far, unpinned and unapproved excluded
    near, mid = res.data["results"]
    assert 0.3 < near["distance_km"] < 0.8
    assert 5 < mid["distance_km"] < 8
    assert near["location_verified"] is False


def test_radius_and_limit(hospitals):
    assert [h["name"] for h in nearby(lat=LAT, lng=LNG, radius_km=1).data["results"]] == ["Near Hospital"]
    assert nearby(lat=LAT, lng=LNG, radius_km=10, limit=1).data["count"] == 1


@pytest.mark.parametrize(
    "params",
    [
        {},                                         # missing lat/lng
        {"lat": 200, "lng": 80},                     # latitude out of range
        {"lat": 13, "lng": -500},                    # longitude out of range
        {"lat": "abc", "lng": 80},                   # not a number
        {"lat": 13, "lng": 80, "radius_km": 1000},   # radius too large
        {"lat": 13, "lng": 80, "limit": 1000},       # too many results requested
    ],
)
def test_nearby_rejects_bad_input(hospitals, params):
    assert nearby(**params).status_code == 400


def test_cities_and_city_browse_without_location(hospitals):
    cities = APIClient().get("/api/hospitals/cities/").data
    assert {"city": "Chennai", "hospitals": 3} in cities  # unapproved not counted
    assert {"city": "Vellore", "hospitals": 1} in cities

    res = APIClient().get("/api/hospitals/", {"city": "vellore"})
    assert [h["name"] for h in res.data] == ["Far Hospital"]


def test_moving_a_pin_resets_verified(hospitals):
    admin = User.objects.create_superuser("admin@example.com", "pw")
    c = APIClient()
    c.force_authenticate(admin)
    h = hospitals["near"]
    h.location_verified = True
    h.save()

    c.patch(f"/api/hospitals/{h.id}/", {"phone": "123"}, format="json")
    h.refresh_from_db()
    assert h.location_verified is True  # unrelated edit keeps it

    c.patch(f"/api/hospitals/{h.id}/", {"latitude": 13.1, "longitude": 80.3}, format="json")
    h.refresh_from_db()
    assert h.location_verified is False


def test_half_a_coordinate_rejected(hospitals):
    admin = User.objects.create_superuser("admin@example.com", "pw")
    c = APIClient()
    c.force_authenticate(admin)
    res = c.post("/api/hospitals/", {"name": "X", "city": "Chennai", "latitude": 13.0}, format="json")
    assert res.status_code == 400
