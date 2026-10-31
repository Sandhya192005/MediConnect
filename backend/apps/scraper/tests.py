"""
Scraper tests. Websites, the browser and OpenStreetMap are faked, so these tests never
touch a real hospital site (see test_live_mock_site for the real-browser check).
"""

import os
import socket
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.utils import timezone
from rest_framework.test import APIClient

from apps.appointments.models import Appointment, AppointmentRequest
from apps.hospitals.models import Hospital
from apps.notifications.models import Notification

from . import browser, geocode, pipeline
from .extract import normalize, rule_based
from .models import ScrapedDoctor, ScrapeJob
from .safety import UnsafeURL, check_public_url

User = get_user_model()

SITE = "http://mockhospital"

# What Playwright would return for the mock site (text as a browser renders it, incl. JS content).
FAKE_PAGES = [
    {"url": f"{SITE}/", "title": "Greenfield Demo Hospital", "text": "Greenfield Demo Hospital\nOur Doctors\nContact",
     "links": [{"url": f"{SITE}/appointments.html", "text": "Book an Appointment"}]},
    {"url": f"{SITE}/doctors.html", "title": "Our Doctors", "links": [], "text": (
        "Dr. Kavitha Raman – Cardiologist · MBBS, MD · Mon–Sat 9:00 am – 1:00 pm\n"
        "Dr. Suresh Babu – Orthopedic Surgeon · Mon, Wed, Fri 4:00 pm – 7:00 pm\n"
        "Dr. Farhan Ali – Dermatologist · Saturday 10:00 am – 1:00 pm\n"
        "Dr. Kavitha Raman – Cardiologist\n"  # duplicate on the page: must be saved once
    )},
    {"url": f"{SITE}/contact.html", "title": "Contact", "links": [], "text": (
        "Phone: +91 44 4000 1234 · Email: info@greenfield-demo.example\nOPD timings: Mon–Sat 8:00 am – 8:00 pm"
    )},
]


@pytest.fixture
def patient(db):
    return User.objects.create_user("pat@x.com", "pw", first_name="Pat")


@pytest.fixture
def admin(db):
    return User.objects.create_superuser("admin@x.com", "pw")


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def fake_browser(monkeypatch):
    calls = []

    def fetch(url, max_pages=None):
        calls.append(url)
        return FAKE_PAGES

    monkeypatch.setattr(browser, "fetch_pages", fetch)
    return calls


# ---- URL safety --------------------------------------------------------------

@pytest.mark.parametrize("url", [
    "http://localhost/", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data", "ftp://example.com/", "http://example.com:8080/",
    "http://user:pass@example.com/", "javascript:alert(1)", "not a url",
])
def test_unsafe_urls_blocked(url):
    with pytest.raises(UnsafeURL):
        check_public_url(url)


def test_public_and_mock_urls_allowed(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, port: [(None, None, None, None, ("93.184.216.34", 0))])
    assert check_public_url("https://hospital.example/doctors") == "https://hospital.example/doctors"
    assert check_public_url("http://mockhospital/") == "http://mockhospital/"


def test_dns_pointing_to_private_ip_blocked(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, port: [(None, None, None, None, ("10.1.2.3", 0))])
    with pytest.raises(UnsafeURL):
        check_public_url("https://evil.example/")


# ---- extraction -----------------------------------------------------------------

def test_rule_based_extraction_and_cleaning():
    data = normalize(rule_based(FAKE_PAGES), SITE)
    names = [d["name"] for d in data["doctors"]]
    assert names == ["Dr. Kavitha Raman", "Dr. Suresh Babu", "Dr. Farhan Ali"]  # duplicate removed
    assert data["doctors"][0]["specialization"].startswith("Cardiologist")
    assert "9:00 am" in data["doctors"][0]["timings"]
    assert data["doctors"][1]["timings"] == "Mon, Wed, Fri 4:00 pm – 7:00 pm"
    assert data["opd_timings"] == "Mon–Sat 8:00 am – 8:00 pm"  # hospital hours, not a doctor's
    assert data["phones"] == ["+91 44 4000 1234"]
    assert data["emails"] == ["info@greenfield-demo.example"]
    assert data["booking_url"] == f"{SITE}/appointments.html"


def test_normalize_drops_unsafe_or_made_up_looking_values():
    raw = {
        "booking_url": "https://phishing.example/book",  # not the hospital's own site
        "phones": ["call us!", "+91 44 4000 1234"],
        "emails": ["nope"],
        "doctors": [{"name": "Dr"}, "garbage", {"name": "dr anita rao", "specialization": "x" * 500}],
    }
    data = normalize(raw, "https://www.hospital.example/")
    assert data["booking_url"] == ""
    assert data["phones"] == ["+91 44 4000 1234"] and data["emails"] == []
    assert [d["name"] for d in data["doctors"]] == ["Dr. anita rao"]
    assert len(data["doctors"][0]["specialization"]) == 150


# ---- pipeline -----------------------------------------------------------------

def test_job_with_url_creates_scraped_hospital(patient, fake_browser):
    job = ScrapeJob.objects.create(url=f"{SITE}/", requested_by=patient)
    assert pipeline.run_job(job.id) == "done"

    job.refresh_from_db()
    h = job.hospital
    assert h.source == "scraped" and h.is_approved is False  # viewable, not a partner
    assert h.source_url == f"{SITE}/" and h.scraped_at is not None
    assert h.booking_url == f"{SITE}/appointments.html"
    assert h.scraped_info["opd_timings"].startswith("Mon")
    assert ScrapedDoctor.objects.filter(hospital=h).count() == 3
    assert all(d.source_url and d.collected_at for d in ScrapedDoctor.objects.filter(hospital=h))
    assert Notification.objects.get(user=patient).title == "Hospital info ready"
    assert Appointment.objects.count() == 0  # scraping never creates bookings


def test_rescrape_replaces_doctor_list_and_is_idempotent(patient, fake_browser, monkeypatch):
    job = ScrapeJob.objects.create(url=f"{SITE}/", requested_by=patient)
    pipeline.run_job(job.id)
    hospital = ScrapeJob.objects.get(pk=job.id).hospital

    assert pipeline.run_job(job.id) == "done"  # re-running a finished job does nothing
    assert len(fake_browser) == 1

    monkeypatch.setattr(browser, "fetch_pages", lambda url, max_pages=None: FAKE_PAGES[:1] + [
        {"url": f"{SITE}/doctors.html", "title": "", "links": [], "text": "Dr. New Person – ENT"}])
    job2 = ScrapeJob.objects.create(hospital=hospital, requested_by=patient)
    pipeline.run_job(job2.id)
    assert list(hospital.scraped_doctors.values_list("name", flat=True)) == ["Dr. New Person"]


def test_query_job_uses_openstreetmap(patient, fake_browser, monkeypatch):
    monkeypatch.setattr(geocode, "find_hospital", lambda q: {
        "name": "Greenfield Demo Hospital", "address": "12 Lake View Road, Chennai", "city": "Chennai",
        "state": "Tamil Nadu", "country": "India", "lat": 13.08, "lng": 80.27, "website": f"{SITE}/", "phone": "",
    })
    job = ScrapeJob.objects.create(query="Greenfield Chennai", requested_by=patient)
    assert pipeline.run_job(job.id) == "done"
    h = ScrapeJob.objects.get(pk=job.id).hospital
    assert h.city == "Chennai" and h.location is not None
    assert h.location_verified is False  # from OpenStreetMap, not checked by our admin
    assert fake_browser == [f"{SITE}/"]


def test_hospital_without_website_saves_map_info_only(patient, monkeypatch):
    monkeypatch.setattr(geocode, "find_hospital", lambda q: {
        "name": "Tiny Clinic", "address": "Main St", "city": "Madurai", "state": "", "country": "India",
        "lat": 9.92, "lng": 78.12, "website": "", "phone": "",
    })
    job = ScrapeJob.objects.create(query="Tiny Clinic Madurai", requested_by=patient)
    assert pipeline.run_job(job.id) == "blocked"
    job.refresh_from_db()
    assert "no website" in job.message
    assert job.hospital.name == "Tiny Clinic" and job.hospital.scraped_at is None


def test_not_found_on_map(patient, monkeypatch):
    monkeypatch.setattr(geocode, "find_hospital", lambda q: None)
    job = ScrapeJob.objects.create(query="zzzz nowhere", requested_by=patient)
    assert pipeline.run_job(job.id) == "failed"
    assert Hospital.objects.count() == 0
    assert "couldn't find" in Notification.objects.get(user=patient).message


def test_robots_txt_block_is_respected(patient, monkeypatch):
    def blocked(url, max_pages=None):
        raise browser.RobotsBlocked("The hospital's website doesn't allow automated reading (robots.txt).")

    monkeypatch.setattr(browser, "fetch_pages", blocked)
    job = ScrapeJob.objects.create(url=f"{SITE}/", requested_by=patient)
    assert pipeline.run_job(job.id) == "blocked"
    assert Hospital.objects.count() == 0 and ScrapedDoctor.objects.count() == 0


def test_unsafe_url_job_blocked(patient):
    job = ScrapeJob.objects.create(url="http://127.0.0.1/admin", requested_by=patient)
    assert pipeline.run_job(job.id) == "blocked"


def test_only_one_active_job_per_hospital(db):
    from django.db import IntegrityError, transaction

    h = Hospital.objects.create(name="H", city="Chennai")
    ScrapeJob.objects.create(hospital=h, status="running")
    with pytest.raises(IntegrityError), transaction.atomic():
        ScrapeJob.objects.create(hospital=h, status="pending")


# ---- lookup / refresh API ------------------------------------------------------------

def test_lookup_requires_login_and_input(db):
    assert APIClient().post("/api/scraper/lookup/", {"q": "x"}, format="json").status_code == 401
    u = User.objects.create_user("u@x.com", "pw")
    assert client_for(u).post("/api/scraper/lookup/", {}, format="json").status_code == 400
    assert client_for(u).post("/api/scraper/lookup/", {"url": "http://localhost/"}, format="json").status_code == 400


def test_lookup_serves_fresh_copy_without_scraping(patient):
    Hospital.objects.create(name="Greenfield Demo Hospital", city="Chennai", source="scraped", is_approved=False,
                            website=f"{SITE}/", scraped_at=timezone.now() - timedelta(hours=2))
    res = client_for(patient).post("/api/scraper/lookup/", {"q": "Greenfield Chennai"}, format="json")
    assert res.status_code == 200
    assert res.data["matches"][0]["is_fresh"] is True
    assert res.data["job"] is None and ScrapeJob.objects.count() == 0


def test_lookup_stale_copy_queues_one_job(patient):
    h = Hospital.objects.create(name="Greenfield Demo Hospital", city="Chennai", source="scraped", is_approved=False,
                                website=f"{SITE}/", scraped_at=timezone.now() - timedelta(days=3))
    c = client_for(patient)
    first = c.post("/api/scraper/lookup/", {"q": "Greenfield"}, format="json").data
    second = c.post("/api/scraper/lookup/", {"q": "Greenfield"}, format="json").data
    assert first["job_created"] is True and second["job_created"] is False
    assert first["job"]["id"] == second["job"]["id"]
    assert ScrapeJob.objects.filter(hospital=h).count() == 1


def test_lookup_unknown_hospital_queues_discovery(patient):
    res = client_for(patient).post("/api/scraper/lookup/", {"q": "Some New Hospital Coimbatore"}, format="json").data
    assert res["matches"] == [] and res["job"]["query"] == "Some New Hospital Coimbatore"


def test_lookup_quota(patient, settings):
    settings.SCRAPER_JOBS_PER_USER_PER_HOUR = 2
    c = client_for(patient)
    assert c.post("/api/scraper/lookup/", {"q": "alpha hospital"}, format="json").status_code == 200
    assert c.post("/api/scraper/lookup/", {"q": "beta hospital"}, format="json").status_code == 200
    assert c.post("/api/scraper/lookup/", {"q": "gamma hospital"}, format="json").status_code == 429


def test_refresh_button_limits(patient):
    h = Hospital.objects.create(name="H", city="Chennai", website=f"{SITE}/", scraped_at=timezone.now())
    c = client_for(patient)
    assert c.post(f"/api/scraper/hospitals/{h.id}/refresh/").status_code == 429  # just refreshed
    Hospital.objects.filter(pk=h.id).update(scraped_at=timezone.now() - timedelta(hours=2))
    assert c.post(f"/api/scraper/hospitals/{h.id}/refresh/").status_code == 202


def test_scraped_hospital_viewable_but_not_in_partner_list(db):
    h = Hospital.objects.create(name="Scraped H", city="Chennai", source="scraped", is_approved=False,
                                location=Point(80.27, 13.08), scraped_at=timezone.now())
    ScrapedDoctor.objects.create(hospital=h, name="Dr. A B", source_url=f"{SITE}/", collected_at=timezone.now())
    detail = APIClient().get(f"/api/scraper/hospitals/{h.id}/").data
    assert detail["scraped_doctors"][0]["name"] == "Dr. A B"
    assert detail["has_bookable_doctors"] is False
    assert APIClient().get("/api/hospitals/").data == []  # not listed as a partner
    assert APIClient().get("/api/hospitals/nearby/?lat=13.08&lng=80.27").data["count"] == 0


def test_job_status_only_for_owner_or_admin(patient, admin):
    job = ScrapeJob.objects.create(query="x", requested_by=patient)
    other = User.objects.create_user("o@x.com", "pw")
    assert client_for(patient).get(f"/api/scraper/jobs/{job.id}/").status_code == 200
    assert client_for(admin).get(f"/api/scraper/jobs/{job.id}/").status_code == 200
    assert client_for(other).get(f"/api/scraper/jobs/{job.id}/").status_code == 404


# ---- appointment requests -------------------------------------------------------------

@pytest.fixture
def scraped(db):
    h = Hospital.objects.create(name="Scraped H", city="Chennai", source="scraped", is_approved=False)
    d = ScrapedDoctor.objects.create(hospital=h, name="Dr. A B", source_url=f"{SITE}/", collected_at=timezone.now())
    return h, d


def _req(c, h, d=None, days=3, **extra):
    body = {"hospital": h.id, "preferred_date": (timezone.localdate() + timedelta(days=days)).isoformat(),
            "preferred_time": "Morning", **extra}
    if d:
        body["scraped_doctor"] = d.id
    return c.post("/api/appointment-requests/", body, format="json")


def test_request_flow(patient, admin, scraped):
    h, d = scraped
    c = client_for(patient)
    res = _req(c, h, d, reason="Chest checkup")
    assert res.status_code == 201
    assert res.data["status"] == "pending" and res.data["status_label"] == "Pending – not confirmed"
    assert Appointment.objects.count() == 0  # a request is not a booking

    assert _req(c, h, d).status_code == 400  # duplicate pending request
    rid = res.data["id"]
    assert client_for(patient).post(f"/api/appointment-requests/{rid}/confirm/").status_code == 403

    res = client_for(admin).post(f"/api/appointment-requests/{rid}/confirm/", {"note": "Come at 10 am"}, format="json")
    assert res.data["status"] == "confirmed"
    n = Notification.objects.get(user=patient)
    assert n.title == "Appointment request confirmed" and "10 am" in n.message


def test_request_validation(patient, scraped, db):
    h, d = scraped
    c = client_for(patient)
    assert _req(c, h, days=-1).status_code == 400  # past date
    assert _req(c, h, days=200).status_code == 400  # too far ahead
    other_h = Hospital.objects.create(name="Other", city="Chennai")
    assert _req(c, other_h, d).status_code == 400  # doctor not at this hospital
    doc_user = User.objects.create_user("doc@x.com", "pw", role="doctor")
    assert _req(client_for(doc_user), h).status_code == 403


def test_requests_private_and_cancellable(patient, scraped):
    h, _ = scraped
    rid = _req(client_for(patient), h).data["id"]
    other = User.objects.create_user("o@x.com", "pw")
    assert client_for(other).get("/api/appointment-requests/").data == []
    assert client_for(other).post(f"/api/appointment-requests/{rid}/cancel/").status_code == 404
    assert client_for(patient).post(f"/api/appointment-requests/{rid}/cancel/").data["status"] == "cancelled"
    assert AppointmentRequest.objects.get(pk=rid).status == "cancelled"


# ---- real browser against the mock site (run inside scraper_worker) ---------------------

@pytest.mark.skipif(os.environ.get("SCRAPER_LIVE") != "1", reason="needs Chromium + the mockhospital container")
def test_live_mock_site():
    pages = browser.fetch_pages("http://mockhospital/")
    urls = [p["url"] for p in pages]
    text = "\n".join(p["text"] for p in pages)
    assert any("doctors" in u for u in urls)
    assert not any("login" in u or "careers" in u for u in urls)  # skipped on purpose
    assert "Dr. Farhan Ali" in text  # added by JavaScript: only a real browser sees it
    data = normalize(rule_based(pages), "http://mockhospital/")
    assert len(data["doctors"]) == 5
