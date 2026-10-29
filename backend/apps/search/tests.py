from datetime import time

import pytest
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from elasticsearch import ConnectionError as ESConnectionError
from rest_framework.test import APIClient

from apps.doctors.models import DoctorProfile, WeeklyAvailability
from apps.hospitals.models import Department, Hospital

from . import documents
from .indexes import es, index_name

User = get_user_model()


def es_available():
    try:
        return es().ping()
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not es_available(), reason="Elasticsearch not running")


def make_doctor(email, first, last, hospital, dept, spec, fee):
    user = User.objects.create_user(email, "pw", role="doctor", first_name=first, last_name=last)
    d = DoctorProfile.objects.get(user=user)
    d.hospital, d.department, d.specialization, d.fee = hospital, dept, spec, fee
    d.save()
    WeeklyAvailability.objects.create(doctor=d, weekday=0, start_time=time(9), end_time=time(10))
    return d


@pytest.fixture
def data(db):
    cardio = Department.objects.create(name="Cardiology")
    derma = Department.objects.create(name="Dermatology")
    chennai = Hospital.objects.create(name="Lakeside Hospital", city="Chennai", location=Point(80.22, 12.97))
    bengaluru = Hospital.objects.create(name="Green Valley Hospital", city="Bengaluru")
    chennai.departments.add(cardio, derma)
    make_doctor("a@x.com", "Anita", "Rao", chennai, cardio, "Cardiologist", 800)
    make_doctor("r@x.com", "Rohan", "Das", bengaluru, cardio, "Interventional Cardiologist", 1200)
    make_doctor("m@x.com", "Meera", "Nair", chennai, derma, "Dermatologist", 600)
    documents.rebuild_all(refresh=True)
    yield
    es().indices.delete(index=f"{index_name('doctors')},{index_name('hospitals')}", ignore_unavailable=True)


def search(**params):
    return APIClient().get("/api/search/", params).data


def names(res):
    return [r["name"] for r in res["results"]]


def test_typo_tolerance(data):
    assert set(names(search(q="cardiolgist"))) == {"Anita Rao", "Rohan Das"}
    assert names(search(q="dermatoligist")) == ["Meera Nair"]


def test_synonyms_everyday_words(data):
    assert set(names(search(q="heart"))) == {"Anita Rao", "Rohan Das"}
    assert names(search(q="skin doctor")) == ["Meera Nair"]


def test_filters_and_facets(data):
    res = search(q="cardiology", city="Chennai")
    assert names(res) == ["Anita Rao"]

    res = search(max_fee=1000)
    assert set(names(res)) == {"Anita Rao", "Meera Nair"}

    facets = {f["value"]: f["count"] for f in search()["facets"]["departments"]}
    assert facets == {"Cardiology": 2, "Dermatology": 1}


def test_highlight_uses_safe_markers(data):
    hl = search(q="anita")["results"][0]["highlight"]["name"][0]
    assert "\u0002" in hl and "<" not in hl


def test_autocomplete(data):
    res = APIClient().get("/api/search/suggest/", {"q": "ani"}).data
    assert [d["name"] for d in res["doctors"]] == ["Anita Rao"]
    res = APIClient().get("/api/search/suggest/", {"q": "green val"}).data
    assert [h["name"] for h in res["hospitals"]] == ["Green Valley Hospital"]


def test_hospital_search(data):
    res = APIClient().get("/api/search/", {"type": "hospitals", "q": "dermatology"}).data
    assert [h["name"] for h in res["results"]] == ["Lakeside Hospital"]


def test_index_stays_in_sync(data, django_capture_on_commit_callbacks):
    # Rename a hospital -> its doctors' documents are updated too (via signal + Celery task)
    with django_capture_on_commit_callbacks(execute=True):
        h = Hospital.objects.get(name="Green Valley Hospital")
        h.name = "Green Valley Heart Institute"
        h.save()
    es().indices.refresh(index=index_name("doctors"))
    assert search(q="Rohan")["results"][0]["hospital_name"] == "Green Valley Heart Institute"

    # Deleting a doctor removes them from search
    with django_capture_on_commit_callbacks(execute=True):
        DoctorProfile.objects.get(user__email="m@x.com").delete()
    es().indices.refresh(index=index_name("doctors"))
    assert names(search(q="dermatologist")) == []


def test_returns_503_when_search_down(data, monkeypatch):
    def boom(*a, **kw):
        raise ESConnectionError("down")

    monkeypatch.setattr("apps.search.queries.search_doctors", boom)
    res = APIClient().get("/api/search/", {"q": "x"})
    assert res.status_code == 503
    assert res.data["fallback"] == "/api/doctors/"
