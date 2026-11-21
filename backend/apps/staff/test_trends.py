"""% trends on the hospital dashboard (owner request 2026-11-21): every number counted from real data."""

from datetime import date, datetime, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile
from apps.hospitals.models import Hospital
from apps.staff.models import HospitalAdmin, StaffMember

User = get_user_model()
NOW = timezone.make_aware(datetime(2026, 11, 21, 12, 0))  # a Saturday, India time


@pytest.fixture(autouse=True)
def frozen_now(monkeypatch):
    monkeypatch.setattr(timezone, "now", lambda: NOW)


def at(y, m, d, h=10):
    return timezone.make_aware(datetime(y, m, d, h, 0))


@pytest.fixture
def world():
    city = Hospital.objects.create(name="City Hospital", city="Chennai", is_approved=True)
    other = Hospital.objects.create(name="Other Hospital", city="Chennai", is_approved=True)
    manager = User.objects.create_user("desk@city.example", "pw", role="hospital")
    HospitalAdmin.objects.create(user=manager, hospital=city)
    user = User.objects.create_user("doc@example.com", "pw", role="doctor", first_name="Priya", last_name="R")
    doctor = DoctorProfile.objects.get(user=user)
    doctor.hospital = city
    doctor.save()
    other_doc_user = User.objects.create_user("doc2@example.com", "pw", role="doctor")
    other_doctor = DoctorProfile.objects.get(user=other_doc_user)
    other_doctor.hospital = other
    other_doctor.save()
    return {"city": city, "other": other, "manager": manager, "doctor": doctor, "other_doctor": other_doctor}


def staff(hospital, kind, joined, left=None):
    return StaffMember.objects.create(hospital=hospital, kind=kind, full_name=f"{kind} {joined}", join_date=joined,
                                      left_on=left, monthly_salary=30000)


def visit(world, patient, start, status="completed", booked_on=None, doctor=None):
    a = Appointment.objects.create(patient=patient, doctor=doctor or world["doctor"], start=start,
                                   end=start + timedelta(minutes=30), status=status)
    Appointment.objects.filter(pk=a.pk).update(created_at=booked_on or start - timedelta(days=2))
    return a


def trends(world):
    c = APIClient()
    c.force_authenticate(world["manager"])
    return c.get("/api/hospital-admin/overview/").json()["trends"]


@pytest.mark.django_db
def test_staff_trends_compare_today_with_the_end_of_last_month(world):
    city = world["city"]
    staff(city, "nurse", date(2026, 1, 1))
    staff(city, "nurse", date(2026, 11, 10))                    # joined this month
    staff(city, "doctor", date(2026, 3, 1), left=date(2026, 11, 5))  # left this month
    staff(world["other"], "nurse", date(2026, 11, 2))           # another hospital: never counted
    t = trends(world)
    assert t["nurses"] == {"now": 2, "before": 1, "change_pct": 100.0}
    assert t["doctors"] == {"now": 0, "before": 1, "change_pct": -100.0}
    assert t["other_staff"] == {"now": 0, "before": 0, "change_pct": None}  # nothing to compare with


@pytest.mark.django_db
def test_patients_and_todays_appointments(world):
    p1, p2, p3, p4, p5 = (User.objects.create_user(f"p{i}@example.com", "pw") for i in range(1, 6))
    visit(world, p1, at(2026, 10, 20), booked_on=at(2026, 10, 15))  # a patient since October
    # Same weekday last week (Sat 14 Nov): 2 visits.
    visit(world, p1, at(2026, 11, 14, 9))
    visit(world, p1, at(2026, 11, 14, 11))
    # Today: 3 visits, plus one cancelled (doesn't count, and doesn't make p5 a patient).
    for p, h in ((p2, 9), (p3, 10), (p4, 11)):
        visit(world, p, at(2026, 11, 21, h), status="booked")
    visit(world, p5, at(2026, 11, 21, 12), status="cancelled")
    visit(world, p5, at(2026, 11, 21, 13), doctor=world["other_doctor"])  # another hospital
    t = trends(world)
    assert t["patients"] == {"now": 4, "before": 1, "change_pct": 300.0}
    assert t["appointments_today"] == {"now": 3, "before": 2, "change_pct": 50.0}


@pytest.mark.django_db
def test_a_new_hospital_has_nothing_to_compare_with(world):
    t = trends(world)
    assert all(v == {"now": 0, "before": 0, "change_pct": None} for v in t.values())
