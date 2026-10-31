"""Hospital directory (all hospitals on the map) tests. OpenStreetMap is faked."""

from datetime import time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.utils import timezone
from rest_framework.test import APIClient

from apps.doctors.models import DoctorProfile, WeeklyAvailability
from apps.hospitals.models import Hospital

from . import directory, geocode, overpass
from .models import OsmTile, ScrapedDoctor

User = get_user_model()

OSM_ITEMS = [
    {"osm_id": "way/1", "name": "Kilpauk Medical College", "lat": 13.0780, "lng": 80.2420, "website": "https://kmc.example",
     "phone": "+91 44 2836 4951", "address": "Poonamallee High Rd", "city": "Chennai", "state": "Tamil Nadu"},
    {"osm_id": "node/2", "name": "Rajan Eye Care Hospital", "lat": 13.0400, "lng": 80.2350, "website": "",
     "phone": "", "address": "", "city": "", "state": ""},
    # Same as a partner hospital already in MediConnect (same name, ~50 m away): must be linked, not duplicated.
    {"osm_id": "way/3", "name": "MediConnect City Hospital", "lat": 13.0605, "lng": 80.2500, "website": "https://osm-says.example",
     "phone": "+91 1111", "address": "OSM address", "city": "Chennai", "state": ""},
]


@pytest.fixture
def partner(db):
    h = Hospital.objects.create(name="MediConnect City Hospital", city="Chennai", address="Anna Salai",
                                location=Point(80.2496, 13.0604), location_verified=True)
    user = User.objects.create_user("doc@x.com", "pw", role="doctor", first_name="Anita")
    d = DoctorProfile.objects.get(user=user)
    d.hospital = h
    d.save()
    WeeklyAvailability.objects.create(doctor=d, weekday=0, start_time=time(9), end_time=time(10))
    return h


@pytest.fixture
def fake_overpass(monkeypatch):
    calls = []

    def fake(s, w, n, e):
        calls.append((s, w, n, e))
        return OSM_ITEMS

    monkeypatch.setattr(overpass, "hospitals_in_box", fake)
    return calls


def test_tiles_cover_the_search_area():
    tiles = directory.tiles_for(13.06, 80.25, 5)
    keys = {k for k, _, _ in tiles}
    assert "130_802" in keys and len(tiles) <= 4
    assert len(directory.tiles_for(13.06, 80.25, 50)) <= 9  # capped at 10 km around the patient


def test_import_creates_links_and_never_overwrites_partner(partner, fake_overpass):
    OsmTile.objects.create(key="130_802", south=13.0, west=80.2)
    assert directory.sync_tile("130_802") == 3

    kmc = Hospital.objects.get(osm_id="way/1")
    assert kmc.source == "osm" and kmc.is_approved is False and kmc.location_verified is False
    assert kmc.website == "https://kmc.example" and kmc.city == "Chennai"

    partner.refresh_from_db()
    assert partner.osm_id == "way/3"  # linked, not duplicated
    assert partner.address == "Anna Salai" and partner.location_verified is True  # partner data kept
    assert partner.website == "https://osm-says.example"  # empty field filled in
    assert Hospital.objects.count() == 3

    tile = OsmTile.objects.get(key="130_802")
    assert tile.status == "done" and tile.hospitals_found == 3

    # Running again (next day) updates in place: still 3 hospitals.
    directory.sync_tile("130_802")
    assert Hospital.objects.count() == 3


def test_ensure_tiles_queues_each_tile_once(db, django_capture_on_commit_callbacks, fake_overpass):
    with django_capture_on_commit_callbacks(execute=True):
        assert directory.ensure_tiles(13.05, 80.25, 3) is True  # first time: downloading
    n_calls = len(fake_overpass)
    assert n_calls >= 1
    assert all(t.status == "done" for t in OsmTile.objects.all())

    with django_capture_on_commit_callbacks(execute=True):
        assert directory.ensure_tiles(13.05, 80.25, 3) is False  # fresh: nothing to do
    assert len(fake_overpass) == n_calls

    OsmTile.objects.update(synced_at=timezone.now() - timedelta(hours=30))
    with django_capture_on_commit_callbacks(execute=True):
        directory.ensure_tiles(13.05, 80.25, 3)  # stale after 24 h: refreshed
    assert len(fake_overpass) > n_calls


def test_failed_tile_waits_before_retry(db, monkeypatch):
    queued = []
    monkeypatch.setattr("apps.scraper.tasks.sync_osm_tile_task.delay", lambda k: queued.append(k))
    OsmTile.objects.create(key="130_802", south=13.0, west=80.2, status="failed")
    OsmTile.objects.filter(key="130_802").update(updated_at=timezone.now())
    directory.ensure_tiles(13.05, 80.25, 1)
    assert "130_802" not in queued  # Overpass was down a moment ago: don't hammer it


def test_nearby_shows_all_with_partner_flag(partner, fake_overpass):
    OsmTile.objects.create(key="130_802", south=13.0, west=80.2)
    directory.sync_tile("130_802")
    res = APIClient().get("/api/hospitals/nearby/", {"lat": 13.06, "lng": 80.25, "radius_km": 5}).data
    by_name = {h["name"]: h for h in res["results"]}
    assert by_name["MediConnect City Hospital"]["is_partner"] is True
    assert by_name["Kilpauk Medical College"]["is_partner"] is False
    assert by_name["Kilpauk Medical College"]["has_website"] is True
    assert res["results"][0]["name"] == "MediConnect City Hospital"  # nearest first

    only = APIClient().get("/api/hospitals/nearby/", {"lat": 13.06, "lng": 80.25, "radius_km": 5, "partners_only": "true"}).data
    assert [h["name"] for h in only["results"]] == ["MediConnect City Hospital"]


def test_city_search(partner, monkeypatch):
    monkeypatch.setattr(geocode, "find_place", lambda name: {"name": "Chennai", "display_name": "Chennai, India", "lat": 13.06, "lng": 80.25}
                        if name.lower() == "chennai" else None)
    res = APIClient().get("/api/hospitals/city/", {"name": "Chennai"})
    assert res.status_code == 200 and res.data["place"]["name"] == "Chennai"
    assert res.data["results"][0]["name"] == "MediConnect City Hospital"
    assert APIClient().get("/api/hospitals/city/", {"name": "Nowhereville"}).status_code == 404
    assert APIClient().get("/api/hospitals/city/", {"name": "x"}).status_code == 400


def test_listed_doctor_search(db):
    h = Hospital.objects.create(name="Kilpauk Medical College", city="Chennai", source="osm", is_approved=False)
    now = timezone.now()
    ScrapedDoctor.objects.create(hospital=h, name="Dr. Kavitha Raman", specialization="Cardiologist", source_url="https://kmc.example", collected_at=now)
    ScrapedDoctor.objects.create(hospital=h, name="Dr. Suresh Babu", specialization="Orthopedic Surgeon", source_url="https://kmc.example", collected_at=now)
    c = APIClient()
    assert [d["name"] for d in c.get("/api/search/listed-doctors/", {"q": "cardio"}).data["results"]] == ["Dr. Kavitha Raman"]
    assert [d["name"] for d in c.get("/api/search/listed-doctors/", {"q": "cardiolgist"}).data["results"]] == ["Dr. Kavitha Raman"]  # typo
    assert len(c.get("/api/search/listed-doctors/", {"hospital": h.id}).data["results"]) == 2
