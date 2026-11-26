"""Doctors added in Doctor management are shown to patients, labelled "not bookable online"
(owner request 2026-11-26: Shiva, a neurologist added by ABC Hospital, didn't appear for "neurology")."""

from datetime import date, timedelta

import pytest
from rest_framework.test import APIClient

from apps.hospitals.models import Department, Hospital
from apps.search import documents
from apps.search.indexes import es, index_name
from apps.search.tests import es_available, make_doctor

from .models import StaffMember

PRIVATE = {"phone", "email", "monthly_salary", "salary", "join_date", "left_on"}


def staff(hospital, name, kind="doctor", **extra):
    return StaffMember.objects.create(hospital=hospital, kind=kind, full_name=name, join_date=date(2024, 4, 22),
                                      monthly_salary=50000, phone="99045 67593", email="x@example.com", **extra)


@pytest.fixture
def data(db):
    neuro, ent = Department.objects.create(name="Neurology"), Department.objects.create(name="ENT")
    abc = Hospital.objects.create(name="ABC Hospital", city="Chennai")
    make_doctor("j@x.com", "Jeevitha", "D", abc, ent, "Otolaryngology", 500)  # bookable (account + hours)
    staff(abc, "Shiva", department=neuro, specialization="Clinical Neurology", qualification="MBBS MD",
          designation="Senior Consultant")
    staff(abc, "Dr. Old Leaver", department=neuro, left_on=date.today() - timedelta(days=1))  # has left
    staff(abc, "Nancy Nurse", kind="nurse", department=neuro)                                   # not a doctor
    only_staff = Hospital.objects.create(name="Sunrise Clinic", city="Chennai")                  # no bookable doctor
    staff(only_staff, "Dr. Priya", specialization="Gynaecology")
    hidden = Hospital.objects.create(name="Not Connected Hospital", city="Chennai", is_approved=False)
    staff(hidden, "Hidden Doctor", department=neuro)
    if es_available():
        documents.rebuild_all(refresh=True)
    yield abc
    if es_available():
        es().indices.delete(index=f"{index_name('doctors')},{index_name('hospitals')}", ignore_unavailable=True)


def search(**params):
    return {r["name"]: r for r in APIClient().get("/api/search/partner-hospitals/", params).data["results"]}


def test_hospitals_with_only_added_doctors_are_listed(data):
    res = search()
    assert set(res) == {"ABC Hospital", "Sunrise Clinic"}  # never the unconnected hospital
    abc = res["ABC Hospital"]
    assert (abc["doctor_count"], abc["bookable_count"]) == (2, 1)  # Jeevitha + Shiva; not the leaver or nurse
    assert {"name": "Neurology", "count": 1} in abc["specialties"]
    assert res["Sunrise Clinic"]["bookable_count"] == 0


@pytest.mark.parametrize("q", ["neurology", "nerology", "neurologist", "brain", "Shiva"])
def test_search_finds_the_added_doctor(data, q):
    abc = search(q=q)["ABC Hospital"]
    assert [d["name"] for d in abc["matching_listed_doctors"]] == ["Shiva"]
    assert abc["matching_doctors"] == []  # Jeevitha (ENT) doesn't match


def test_only_safe_details_are_public(data):
    shiva = search(q="neurology")["ABC Hospital"]["matching_listed_doctors"][0]
    assert shiva == {"id": shiva["id"], "name": "Shiva", "specialization": "Clinical Neurology",
                     "department": "Neurology", "qualification": "MBBS MD", "designation": "Senior Consultant",
                     "bookable": False}
    assert not PRIVATE & set(shiva)


def test_department_filter_and_fee_limit(data):
    assert set(search(department="Neurology")) == {"ABC Hospital"}
    assert set(search(max_fee=1000)) == {"ABC Hospital"}  # no fee known: added doctors are left out
    assert search(max_fee=1000)["ABC Hospital"]["matching_listed_doctors"] == []


def test_hospital_name_search_for_a_hospital_without_bookable_doctors(data):
    assert set(search(q="sunrise")) == {"Sunrise Clinic"}


def test_doctor_with_bookable_account_is_not_listed_twice(data):
    from apps.doctors.models import DoctorProfile

    staff(data, "Jeevitha D", doctor=DoctorProfile.objects.get(user__email="j@x.com"))
    abc = search()["ABC Hospital"]
    assert (abc["doctor_count"], abc["bookable_count"]) == (2, 1)


def test_hospital_page_lists_added_doctors(data):
    page = APIClient().get(f"/api/scraper/hospitals/{data.id}/").data
    assert [d["name"] for d in page["hospital_listed_doctors"]] == ["Shiva"]
    assert not PRIVATE & set(page["hospital_listed_doctors"][0])
