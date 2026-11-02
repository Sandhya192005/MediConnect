"""Finding doctor pages through sitemaps, reading profile pages, and borrowing a nearby twin's website."""

import pytest
from django.contrib.gis.geos import Point

from apps.hospitals.models import Hospital

from . import pipeline, sitemap
from .extract import normalize, rule_based, specialty_from_url

SITE = "https://hospital.example"


@pytest.fixture
def fake_site(monkeypatch):
    """A website whose files are a dict {url: text}; anything else is 'not found'."""
    files = {}
    monkeypatch.setattr(sitemap, "_get", lambda client, url, site: files.get(url))
    return files


def urlset(*urls):
    return "<urlset>" + "".join(f"<url><loc>{u}</loc></url>" for u in urls) + "</urlset>"


def test_sitemap_finds_doctor_pages_the_homepage_never_links(fake_site):
    fake_site[f"{SITE}/robots.txt"] = f"User-agent: *\nSitemap: {SITE}/wp-sitemap.xml\n"
    fake_site[f"{SITE}/wp-sitemap.xml"] = (
        f"<sitemapindex><sitemap><loc>{SITE}/sitemap-events.xml</loc></sitemap>"
        f"<sitemap><loc>{SITE}/sitemap-pages.xml</loc></sitemap></sitemapindex>"
    )
    fake_site[f"{SITE}/sitemap-pages.xml"] = urlset(
        f"{SITE}/about/",
        f"{SITE}/kidney/meet-the-doctors/dr-rajan-ravichandran/",
        f"{SITE}/our-doctors/",
        f"{SITE}/thank-you-doctor-camp/",  # form "thank you" page: skipped
        f"{SITE}/private/doctors/",  # robots.txt says no
        "https://other-site.example/doctors/",  # another website: skipped
    )
    fake_site[f"{SITE}/sitemap-events.xml"] = urlset(f"{SITE}/events/doctors-day/")
    urls = sitemap.doctor_urls(SITE, allowed=lambda u: "/private/" not in u, limit=10)
    assert urls == [f"{SITE}/our-doctors/", f"{SITE}/kidney/meet-the-doctors/dr-rajan-ravichandran/"]


def test_sitemap_without_robots_line_tries_usual_places(fake_site):
    fake_site[f"{SITE}/sitemap.xml"] = urlset(f"{SITE}/doctors.html")
    assert sitemap.doctor_urls(SITE, allowed=lambda u: True) == [f"{SITE}/doctors.html"]


def test_no_sitemap_is_fine(fake_site):
    assert sitemap.doctor_urls(SITE, allowed=lambda u: True) == []


def test_removed_list_pages_dont_crowd_out_profiles():
    lists = [f"{SITE}/c{i}/meet-the-doctors/" for i in range(8)]
    profiles = [f"{SITE}/c{i}/meet-the-doctors/dr-{i}/" for i in range(8)]
    picked = sitemap._mix(lists + profiles, 10)
    assert len(picked) == 10 and sum("/dr-" in u for u in picked) == 5


def test_every_sitemap_request_is_checked(monkeypatch):
    class Client:
        def get(self, url):
            raise AssertionError("must not request a private address")

    assert sitemap._get(Client(), "http://10.0.0.5/sitemap.xml", "http://10.0.0.5/") is None


def test_profile_page_gives_one_doctor_with_specialty_from_address():
    pages = [
        {"url": f"{SITE}/", "title": "Home", "text": "Welcome", "links": []},
        {"url": f"{SITE}/centers-of-excellence/kidney-transplant/meet-the-doctors/dr-rajan-ravichandran/",
         "title": "Dr. Rajan Ravichandran | Demo Hospital", "text": "Senior consultant", "links": []},
        {"url": f"{SITE}/x/dr-mohandas/", "title": "Prof. Dr. P V A Mohandas - Demo", "text": "", "links": []},
    ]
    doctors = normalize(rule_based(pages), SITE)["doctors"]
    assert [(d["name"], d["specialization"]) for d in doctors] == [
        ("Dr. Rajan Ravichandran", "Kidney Transplant"), ("Dr. P V A Mohandas", "X"),
    ]
    assert specialty_from_url(f"{SITE}/doctors/dr-a.html") == ""


def test_rules_clean_up_names_specialties_and_booking_links():
    text = (
        "Dr. P.V.A. Mohandas – discusses the gaps in healthcare today\n"  # a news line, not a specialty
        "Dr. P V A Mohandas – Orthopaedic Surgeon\n"  # same doctor, written differently
        "Dr. Meera Nair – Dermatologist\n"
    )
    links = [
        {"url": f"{SITE}/symphony-on-your-plate-cookbook/", "text": "Cookbook"},
        {"url": f"{SITE}/cookbook/#book-appointment", "text": "Book an appointment"},
        {"url": f"{SITE}/book-appointment/", "text": "Book now"},
    ]
    data = normalize(rule_based([{"url": SITE, "title": "Home", "text": text, "links": links}]), SITE)
    assert [(d["name"], d["specialization"]) for d in data["doctors"]] == [
        ("Dr. P.V.A. Mohandas", "Orthopaedic Surgeon"), ("Dr. Meera Nair", "Dermatologist"),
    ]
    assert data["booking_url"] == f"{SITE}/book-appointment/"


def test_hospital_mapped_twice_borrows_its_twins_website(db):
    twin = Hospital.objects.create(name="MIOT International", city="Chennai", source="osm", is_approved=False,
                                   website="https://www.miotinternational.com/", location=Point(80.1868, 13.0207))
    me = Hospital.objects.create(name="MIOT Hospital", city="Chennai", source="osm", is_approved=False,
                                 location=Point(80.1880, 13.0210))  # ~130 m away
    Hospital.objects.create(name="Sri Hospital", city="Chennai", location=Point(80.1881, 13.0211))
    Hospital.objects.create(name="Sri Ramachandra Hospital", city="Chennai", website="https://sriramachandra.example",
                            location=Point(80.1882, 13.0212))
    far = Hospital.objects.create(name="MIOT Hospital", city="Madurai", location=Point(78.12, 9.92))

    assert pipeline.nearby_namesake(me) == twin
    assert pipeline.nearby_namesake(Hospital.objects.get(name="Sri Hospital")) is None  # "Sri" is too short to trust
    assert pipeline.nearby_namesake(far) is None  # same name, other city

    assert pipeline.find_missing_website(me) == twin.website
    me.refresh_from_db()
    assert (me.website, me.website_source) == (twin.website, "nearby") and me.website_checked_at
