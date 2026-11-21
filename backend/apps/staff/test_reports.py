"""The hospital's Reports page (owner request 2026-11-20): numbers for one hospital, from its real appointments."""

from datetime import datetime, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile
from apps.hospitals.models import Department, Hospital
from apps.staff.models import HospitalAdmin

User = get_user_model()
NOW = datetime(2026, 11, 20, 12, 0)  # local time (IST): the report's "today"


@pytest.fixture(autouse=True)
def frozen_now(monkeypatch):
    fixed = timezone.make_aware(NOW)
    monkeypatch.setattr(timezone, "now", lambda: fixed)


def at(y, m, d):
    return timezone.make_aware(datetime(y, m, d, 12, 0))


def doctor(email, first, hospital, department=None):
    user = User.objects.create_user(email, "pw", role="doctor", first_name=first, last_name="Raman")
    profile = DoctorProfile.objects.get(user=user)
    profile.hospital, profile.department = hospital, department
    profile.save()
    return profile


def visit(patient, doc, when, status="completed", cancelled_by=""):
    return Appointment.objects.create(patient=patient, doctor=doc, start=when, end=when + timedelta(minutes=30),
                                      status=status, cancelled_by=cancelled_by)


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def world():
    city = Hospital.objects.create(name="City Hospital", city="Chennai", is_approved=True)
    other = Hospital.objects.create(name="Other Hospital", city="Chennai", is_approved=True)
    cardio = Department.objects.create(name="Cardiology")
    a = doctor("a@example.com", "Priya", city, cardio)
    b = doctor("b@example.com", "Bala", city)  # no department
    c = doctor("c@example.com", "Chitra", other)
    p1, p2, p3, p4 = (User.objects.create_user(f"p{i}@example.com", "pw", first_name=f"P{i}") for i in range(1, 5))

    visit(p1, a, at(2026, 8, 10))                      # before the 3-month window: makes P1 a returning patient
    visit(p1, a, at(2026, 10, 5))                      # Oct, returning
    visit(p2, a, at(2026, 9, 3))                       # Sep, new
    visit(p2, b, at(2026, 11, 25), status="booked")    # Nov, returning, upcoming
    visit(p4, b, at(2026, 11, 1))                      # Nov, new
    visit(p3, a, at(2026, 10, 7), "cancelled", "patient")
    visit(p3, b, at(2026, 11, 2), "cancelled", "hospital")   # declined by the hospital
    visit(p3, b, at(2026, 9, 9), "cancelled", "doctor")
    visit(p1, c, at(2026, 10, 6))                      # another hospital: never counted

    manager = User.objects.create_user("info@city.example", "pw", role="hospital")
    HospitalAdmin.objects.create(user=manager, hospital=city)
    other_manager = User.objects.create_user("info@other.example", "pw", role="hospital")
    HospitalAdmin.objects.create(user=other_manager, hospital=other)
    return {"manager": manager, "other_manager": other_manager, "p1": p1}


@pytest.mark.django_db
def test_reports_count_only_this_hospitals_visits_by_month(world):
    r = client_for(world["manager"]).get("/api/hospital-admin/reports/?months=3")
    assert r.status_code == 200
    data = r.json()
    assert data["months"] == ["Sep 2026", "Oct 2026", "Nov 2026"]
    assert data["appointments"] == {"booked": [1, 1, 2], "completed": [1, 1, 1], "no_show": [0, 0, 0]}
    assert data["totals"] == {"appointments": 4, "completed": 3, "no_show": 0, "upcoming": 1, "cancelled_by_patient": 1,
                              "cancelled_by_doctor": 1, "declined_by_hospital": 1}
    # P2 new in Sep, P1 returning in Oct (first visit in Aug), P4 new and P2 returning in Nov; P3 only cancelled.
    assert data["patients"] == {"new": [1, 0, 1], "returning": [0, 1, 1], "unique": 3, "new_total": 2}


@pytest.mark.django_db
def test_reports_per_doctor_and_department(world):
    data = client_for(world["manager"]).get("/api/hospital-admin/reports/?months=3").json()
    doctors = {d["name"]: d for d in data["doctors"]}
    assert set(doctors) == {"Priya Raman", "Bala Raman"}  # not the other hospital's doctor
    assert {k: doctors["Priya Raman"][k] for k in ("department", "appointments", "completed", "cancelled", "patients")} == \
        {"department": "Cardiology", "appointments": 2, "completed": 2, "cancelled": 1, "patients": 2}
    assert {k: doctors["Bala Raman"][k] for k in ("department", "appointments", "completed", "cancelled", "patients")} == \
        {"department": "", "appointments": 2, "completed": 1, "cancelled": 2, "patients": 2}
    assert data["departments"] == [
        {"name": "Cardiology", "doctors": 1, "appointments": 2, "completed": 2, "cancelled": 1, "no_show": 0, "patients": 2},
        {"name": "", "doctors": 1, "appointments": 2, "completed": 1, "cancelled": 2, "no_show": 0, "patients": 2},
    ]


@pytest.mark.django_db
def test_the_period_switch_changes_the_window(world):
    data = client_for(world["manager"]).get("/api/hospital-admin/reports/?months=6").json()
    assert data["months"][0] == "Jun 2026" and len(data["months"]) == 6
    assert data["appointments"]["completed"][2] == 1  # the August visit is inside 6 months
    assert data["patients"]["new"] == [0, 0, 1, 1, 0, 1]  # P1 is new in August now
    bad = client_for(world["manager"]).get("/api/hospital-admin/reports/?months=abc").json()
    assert len(bad["months"]) == 12  # a bad value falls back to 12


@pytest.mark.django_db
def test_other_hospitals_and_other_roles_cannot_see_them(world):
    mine = client_for(world["other_manager"]).get("/api/hospital-admin/reports/?months=3").json()
    assert mine["totals"]["appointments"] == 1 and [d["name"] for d in mine["doctors"]] == ["Chitra Raman"]
    assert client_for(world["p1"]).get("/api/hospital-admin/reports/").status_code == 403
    platform = User.objects.create_superuser("owner@example.com", "pw")
    assert client_for(platform).get("/api/hospital-admin/reports/").status_code == 403  # platform admin has its own reports
    assert APIClient().get("/api/hospital-admin/reports/").status_code == 401
