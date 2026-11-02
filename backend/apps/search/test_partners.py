"""MediConnect hospitals list: GET /api/search/partner-hospitals/."""

import pytest
from django.contrib.auth import get_user_model
from elasticsearch import ConnectionError as ESConnectionError
from rest_framework.test import APIClient

from apps.doctors.models import DoctorProfile
from apps.hospitals.models import Department, Hospital

from . import documents, partners
from .indexes import es, index_name
from .tests import es_available, make_doctor

User = get_user_model()


@pytest.fixture
def data(db):
    cardio = Department.objects.create(name="Cardiology")
    derma = Department.objects.create(name="Dermatology")
    lakeside = Hospital.objects.create(name="Lakeside Hospital", city="Chennai")
    valley = Hospital.objects.create(name="Green Valley Hospital", city="Bengaluru")
    make_doctor("a@x.com", "Anita", "Rao", lakeside, cardio, "Cardiologist", 800)
    make_doctor("m@x.com", "Meera", "Nair", lakeside, derma, "Dermatologist", 600)
    make_doctor("r@x.com", "Rohan", "Das", valley, cardio, "Interventional Cardiologist", 1200)
    # Not partners: an unapproved hospital, and a doctor without working hours.
    hidden = Hospital.objects.create(name="Unapproved Heart Centre", city="Chennai", is_approved=False)
    make_doctor("u@x.com", "Usha", "Iyer", hidden, cardio, "Cardiologist", 500)
    no_hours = DoctorProfile.objects.get(user=User.objects.create_user("n@x.com", "pw", role="doctor", first_name="Nila"))
    no_hours.hospital, no_hours.department = Hospital.objects.create(name="Empty Hospital", city="Chennai"), cardio
    no_hours.save()
    if es_available():
        documents.rebuild_all(refresh=True)
    yield
    if es_available():
        es().indices.delete(index=f"{index_name('doctors')},{index_name('hospitals')}", ignore_unavailable=True)


def get(**params):
    return APIClient().get("/api/search/partner-hospitals/", params).data


def by_name(res):
    return {r["name"]: r for r in res["results"]}


def test_lists_only_partner_hospitals_with_specialties(data):
    res = by_name(get())
    assert set(res) == {"Lakeside Hospital", "Green Valley Hospital"}
    assert res["Lakeside Hospital"]["specialties"] == [{"name": "Cardiology", "count": 1}, {"name": "Dermatology", "count": 1}]
    assert res["Lakeside Hospital"]["doctor_count"] == 2
    assert res["Lakeside Hospital"]["matching_doctors"] == []  # nothing searched


needs_es = pytest.mark.skipif(not es_available(), reason="Elasticsearch not running")


@needs_es
def test_specialty_search_finds_hospitals_and_their_specialists(data):
    res = get(q="heart")  # everyday word → cardiology (synonyms)
    found = by_name(res)
    assert set(found) == {"Lakeside Hospital", "Green Valley Hospital"}
    assert [d["name"] for d in found["Lakeside Hospital"]["matching_doctors"]] == ["Anita Rao"]  # not the dermatologist
    assert by_name(get(q="dermatoligist"))["Lakeside Hospital"]["matching_doctors"][0]["name"] == "Meera Nair"  # typo


@needs_es
def test_hospital_name_search_and_filters(data):
    res = get(q="Lakeside")
    assert [r["name"] for r in res["results"]] == ["Lakeside Hospital"]
    assert res["results"][0]["matching_doctors"] == []  # hospital itself matched: show its specialties instead

    assert set(by_name(get(department="Cardiology"))) == {"Lakeside Hospital", "Green Valley Hospital"}
    assert set(by_name(get(department="Dermatology"))) == {"Lakeside Hospital"}
    assert set(by_name(get(city="Bengaluru"))) == {"Green Valley Hospital"}
    assert set(by_name(get(max_fee=900))) == {"Lakeside Hospital"}  # Rohan Das costs 1200


def test_works_without_elasticsearch(data, monkeypatch):
    def down(q):
        raise ESConnectionError("down")

    monkeypatch.setattr(partners, "_es_matches", down)
    res = get(q="Cardiologist")
    assert res["degraded"] is True
    assert set(by_name(res)) == {"Lakeside Hospital", "Green Valley Hospital"}

