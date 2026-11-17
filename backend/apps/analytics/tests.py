"""Platform analytics: totals, growth, monthly usage, hospital growth, and who may see them."""

from datetime import datetime, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.analytics.services import month_starts, pct_change
from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile, WeeklyAvailability
from apps.hospitals.models import Hospital

User = get_user_model()
NOW = timezone.make_aware(datetime(2026, 11, 18, 12, 0))


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(timezone, "now", lambda: NOW)


def client_for(user=None):
    c = APIClient()
    if user:
        c.force_authenticate(user)
    return c


def joined(user, days_ago):
    User.objects.filter(pk=user.pk).update(date_joined=NOW - timedelta(days=days_ago))


@pytest.fixture
def boss():
    return User.objects.create_superuser("boss@example.com", "pw")


@pytest.fixture
def world():
    """Two connected hospitals (one in Oct, one in Nov), one not connected, doctors, patients, appointments."""
    old = Hospital.objects.create(name="Old Hospital", city="Chennai", is_approved=True)
    new = Hospital.objects.create(name="New Hospital", city="Madurai", is_approved=True)
    Hospital.objects.create(name="Map Listing", city="Chennai", is_approved=False, source="osm")
    Hospital.objects.filter(pk=old.pk).update(approved_at=NOW - timedelta(days=30))  # 19 Oct

    doc_user = User.objects.create_user("doc@example.com", "pw", role="doctor", first_name="Priya")
    joined(doc_user, 40)
    doc = DoctorProfile.objects.get(user=doc_user)
    doc.hospital = old
    doc.save()
    WeeklyAvailability.objects.create(doctor=doc, weekday=0, start_time="09:00", end_time="10:00")

    p1 = User.objects.create_user("p1@example.com", "pw", first_name="Asha")
    p2 = User.objects.create_user("p2@example.com", "pw", first_name="Ravi")
    joined(p1, 35)  # joined in October
    for patient, days_ago, status in [(p1, 30, "completed"), (p1, -1, "booked"), (p2, -2, "booked"), (p2, -3, "cancelled")]:
        start = NOW - timedelta(days=days_ago)
        Appointment.objects.create(patient=patient, doctor=doc, start=start, end=start + timedelta(minutes=30), status=status)
    return {"old": old, "new": new, "doc": doc, "p1": p1, "p2": p2}


def test_month_starts_and_percent_change():
    assert [m.isoformat() for m in month_starts(3, NOW.date())] == ["2026-09-01", "2026-10-01", "2026-11-01"]
    assert month_starts(2, NOW.date().replace(month=1))[0].isoformat() == "2025-12-01"
    assert pct_change(12, 10) == 20.0 and pct_change(5, 0) is None


@pytest.mark.django_db
def test_only_the_platform_admin_sees_platform_analytics(world):
    hospital_admin = User.objects.create_user("ha@example.com", "pw", role="admin")
    for user in (world["p1"], world["doc"].user, hospital_admin):
        assert client_for(user).get("/api/platform/overview/").status_code == 403
        assert client_for(user).get("/api/platform/reports/").status_code == 403
    assert client_for().get("/api/platform/overview/").status_code == 401


@pytest.mark.django_db
def test_overview_totals_and_growth(world, boss):
    o = client_for(boss).get("/api/platform/overview/").json()
    # Patients: Asha joined in October, Ravi this month → 2 now, 1 at the start of the month → +100 %.
    assert o["patients"] == {"total": 2, "new_this_month": 1, "change_pct": 100.0}
    assert o["doctors"]["total"] == 1 and o["doctors"]["new_this_month"] == 0
    # Hospitals: 2 connected (1 before November), 1 bookable (has a doctor with hours), 1 map listing not connected.
    assert o["hospitals"]["total"] == 2 and o["hospitals"]["change_pct"] == 100.0
    assert (o["hospitals"]["bookable"], o["hospitals"]["listed_not_connected"]) == (1, 1)
    assert o["appointments"]["this_month"] == 4
    # Active users per month (cancelled visits don't count): October: Asha; November: Asha and Ravi.
    assert o["activity"]["months"][-2:] == ["Oct 2026", "Nov 2026"]
    assert o["activity"]["active_patients"][-2:] == [1, 2]
    assert o["activity"]["active_doctors"][-2:] == [1, 1]
    assert {e["kind"] for e in o["recent"]} >= {"patient", "doctor", "hospital"}


@pytest.mark.django_db
def test_reports_usage_and_hospital_growth(world, boss):
    r = client_for(boss).get("/api/platform/reports/?months=3").json()
    assert r["months"] == ["Sep 2026", "Oct 2026", "Nov 2026"]
    assert r["usage"]["new_patients"] == [0, 1, 1]
    assert r["usage"]["new_doctors"] == [0, 1, 0]
    assert r["usage"]["appointments_completed"] == [0, 1, 0]
    assert r["growth"]["new_hospitals"] == [0, 1, 1]
    assert r["growth"]["total_hospitals"] == [0, 1, 2]
    assert r["growth"]["total_patients"] == [0, 1, 2]

    table = {h["name"]: h for h in r["hospitals"]}
    assert set(table) == {"Old Hospital", "New Hospital"}  # map listings aren't connected
    assert (table["Old Hospital"]["doctors"], table["Old Hospital"]["patients"], table["Old Hospital"]["appointments"]) == (1, 2, 3)
    assert table["New Hospital"]["appointments"] == 0


@pytest.mark.django_db
def test_months_parameter_is_clamped(boss):
    assert len(client_for(boss).get("/api/platform/reports/?months=99").json()["months"]) == 24
    assert len(client_for(boss).get("/api/platform/reports/?months=abc").json()["months"]) == 12


@pytest.mark.django_db
def test_approval_date_follows_approval():
    h = Hospital.objects.create(name="Pending", city="Chennai", is_approved=False)
    assert h.approved_at is None
    h.is_approved = True
    h.save()
    assert h.approved_at == NOW and h.approved_at_estimated is False
    h.is_approved = False
    h.save(update_fields=["is_approved"])
    h.refresh_from_db()
    assert h.approved_at is None
