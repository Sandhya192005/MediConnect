"""Finding a missing hospital website on Wikidata. Wikidata is faked (see conftest.fake_wikidata)."""

from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.utils import timezone
from rest_framework.test import APIClient

from apps.hospitals.models import Hospital

from . import browser, directory, pipeline, wikidata
from .models import ScrapeJob

User = get_user_model()
CHENNAI = (13.06, 80.25)


def entity(site=None, coords=None, country=None):
    claims = {}
    if site:
        claims["P856"] = [{"mainsnak": {"datavalue": {"value": site}}}]
    if coords:
        claims["P625"] = [{"mainsnak": {"datavalue": {"value": {"latitude": coords[0], "longitude": coords[1]}}}}]
    if country:
        claims["P17"] = [{"mainsnak": {"datavalue": {"value": {"id": country}}}}]
    return {"claims": claims}


@pytest.mark.parametrize("name,label,ok", [
    ("Apollo Hospital", "Apollo Hospitals", True),
    ("Apollo Speciality Hospital - Block A", "Apollo Hospitals", True),  # branch of a group
    ("Cancer Institute", "Adyar Cancer Institute", True),
    ("Sri Hospital", "Sri Ramachandra Institute", False),  # one shared word isn't enough
    ("Kauvery Hospital", "Apollo Hospitals", False),
    ("Hospital", "Hospital", False),  # nothing distinctive
])
def test_names_match(name, label, ok):
    assert wikidata.names_match(name, label) is ok


def test_search_rejects_same_name_in_another_city(fake_wikidata):
    fake_wikidata.search = [{"id": "Q1", "label": "Institute of Child Health"}]
    fake_wikidata.entities = {"Q1": entity("http://www.ich.gr/", coords=(37.98, 23.73), country="Q41")}  # Athens
    assert wikidata.find_website("Institute of Child Health", *CHENNAI) is None


def test_search_accepts_nearby_hospital(fake_wikidata):
    fake_wikidata.search = [{"id": "Q2", "label": "Sundaram Medical Foundation"}]
    fake_wikidata.entities = {"Q2": entity("http://www.smfhospital.org/", coords=(13.08, 80.21))}
    hit = wikidata.find_website("Sundaram Medical Foundation", *CHENNAI)
    assert hit == {"url": "http://www.smfhospital.org/", "qid": "Q2", "label": "Sundaram Medical Foundation"}


def test_search_accepts_group_from_same_country_and_caches(fake_wikidata):
    fake_wikidata.search = [{"id": "Q4780321", "label": "Apollo Hospitals"}]
    fake_wikidata.entities = {"Q4780321": entity("http://www.apollohospitals.com/", country="Q668")}
    assert wikidata.find_website("Apollo Hospital", *CHENNAI)["url"] == "http://www.apollohospitals.com/"
    calls = len(fake_wikidata.calls)
    assert wikidata.find_website("Apollo Hospital", *CHENNAI)["url"] == "http://www.apollohospitals.com/"
    assert len(fake_wikidata.calls) == calls  # second time from the cache


def test_map_import_fills_websites_from_linked_wikidata(db, fake_wikidata):
    fake_wikidata.entities = {"Q4780321": entity("https://www.apollohospitals.com/")}
    items = [
        {"osm_id": "node/1", "name": "Apollo Hospital", "lat": 13.0, "lng": 80.2, "website": "", "phone": "",
         "address": "No.645, TH Road", "city": "Chennai", "state": "", "wikidata_ids": ["Q4780321"]},
        {"osm_id": "node/2", "name": "Own Site Hospital", "lat": 13.0, "lng": 80.2, "website": "https://own.example",
         "phone": "", "address": "", "city": "Chennai", "state": "", "wikidata_ids": []},
    ]
    directory.fill_websites_from_wikidata(items)
    directory.upsert_hospitals(items)
    apollo, own = Hospital.objects.get(osm_id="node/1"), Hospital.objects.get(osm_id="node/2")
    assert (apollo.website, apollo.website_source, apollo.wikidata_id) == ("https://www.apollohospitals.com/", "wikidata", "Q4780321")
    assert apollo.address == "No.645, TH Road"
    assert (own.website, own.website_source) == ("https://own.example", "osm")


@pytest.fixture
def patient(db):
    return User.objects.create_user("p@x.com", "pw", role="patient")


@pytest.fixture
def map_hospital(db):
    return Hospital.objects.create(name="Sundaram Medical Foundation", city="Chennai", source="osm",
                                   is_approved=False, location=Point(80.21, 13.08))


def test_job_finds_missing_website_then_reads_it(patient, map_hospital, fake_wikidata, monkeypatch):
    fake_wikidata.search = [{"id": "Q2", "label": "Sundaram Medical Foundation"}]
    fake_wikidata.entities = {"Q2": entity("http://mockhospital/", coords=(13.08, 80.21))}
    read = []
    monkeypatch.setattr(browser, "fetch_pages", lambda url, max_pages=None: read.append(url) or [
        {"url": url, "title": "SMF", "links": [], "text": "Dr. Kavya Iyer - Cardiology\nOPD Timings: Mon-Sat 9 AM - 5 PM"}])
    job = ScrapeJob.objects.create(hospital=map_hospital, requested_by=patient)
    assert pipeline.run_job(job.id) == "done"
    map_hospital.refresh_from_db()
    assert read == ["http://mockhospital/"]
    assert (map_hospital.website, map_hospital.website_source) == ("http://mockhospital/", "wikidata")
    assert map_hospital.website_checked_at is not None and map_hospital.scraped_at is not None


def test_website_search_runs_once_then_asks_to_paste(patient, map_hospital):
    c = APIClient()
    c.force_authenticate(patient)
    detail = c.get(f"/api/scraper/hospitals/{map_hospital.id}/").data
    assert detail["can_search_website"] is True and detail["website_source"] == ""

    job = ScrapeJob.objects.create(hospital=map_hospital, requested_by=patient)
    assert pipeline.run_job(job.id) == "blocked"  # Wikidata (fake) knows nothing
    job.refresh_from_db()
    assert "paste it" in job.message

    assert c.get(f"/api/scraper/hospitals/{map_hospital.id}/").data["can_search_website"] is False
    res = c.post(f"/api/scraper/hospitals/{map_hospital.id}/refresh/", {}, format="json")
    assert res.status_code == 400 and "Paste" in res.data["detail"]

    # 30 days later we may look again.
    Hospital.objects.filter(pk=map_hospital.pk).update(website_checked_at=timezone.now() - timedelta(days=31))
    assert c.post(f"/api/scraper/hospitals/{map_hospital.id}/refresh/", {}, format="json").status_code == 202


def test_wikidata_error_is_not_cached_as_not_found(fake_wikidata, monkeypatch):
    import conftest

    fake_wikidata.get = lambda url, params=None: conftest._FakeResponse({"error": {"code": "ratelimited"}})
    with pytest.raises(wikidata.WikidataError):
        wikidata.find_website("Apollo Hospital", *CHENNAI)
    del fake_wikidata.get  # Wikidata is back
    fake_wikidata.search = [{"id": "Q4780321", "label": "Apollo Hospitals"}]
    fake_wikidata.entities = {"Q4780321": entity("http://www.apollohospitals.com/", country="Q668")}
    assert wikidata.find_website("Apollo Hospital", *CHENNAI)["url"] == "http://www.apollohospitals.com/"


def test_job_does_not_mark_searched_when_wikidata_is_down(patient, map_hospital, fake_wikidata):
    import conftest

    fake_wikidata.get = lambda url, params=None: conftest._FakeResponse({"error": {"code": "ratelimited"}})
    job = ScrapeJob.objects.create(hospital=map_hospital, requested_by=patient)
    assert pipeline.run_job(job.id) == "blocked"
    map_hospital.refresh_from_db()
    assert map_hospital.website_checked_at is None  # next page view tries again
