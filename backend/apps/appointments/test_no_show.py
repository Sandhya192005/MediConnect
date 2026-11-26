"""No-show (owner request 2026-11-20): the doctor or hospital marks by hand that a patient didn't come."""

from datetime import datetime, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile
from apps.hospitals.models import Hospital
from apps.notifications.models import Notification
from apps.notifications.tasks import complete_past_appointments
from apps.staff.models import HospitalAdmin
from apps.staff.reports import hospital_reports

User = get_user_model()
NOW = timezone.make_aware(datetime(2026, 11, 20, 15, 0))  # IST


@pytest.fixture(autouse=True)
def frozen_now(monkeypatch):
    monkeypatch.setattr(timezone, "now", lambda: NOW)


@pytest.fixture
def world():
    hospital = Hospital.objects.create(name="City Hospital", city="Chennai", is_approved=True)
    user = User.objects.create_user("doc@example.com", "pw", role="doctor", first_name="Priya", last_name="Raman")
    doctor = DoctorProfile.objects.get(user=user)
    doctor.hospital = hospital
    doctor.save()
    manager = User.objects.create_user("desk@city.example", "pw", role="hospital")
    HospitalAdmin.objects.create(user=manager, hospital=hospital)
    patient = User.objects.create_user("asha@example.com", "pw", first_name="Asha", last_name="K")
    return {"hospital": hospital, "doctor": doctor, "manager": manager, "patient": patient}


def visit(w, hours_from_now, status="confirmed", **extra):
    start = NOW + timedelta(hours=hours_from_now)
    return Appointment.objects.create(patient=w["patient"], doctor=w["doctor"], start=start,
                                      end=start + timedelta(minutes=15), status=status, **extra)


def post(user, appt, action):
    c = APIClient()
    c.force_authenticate(user)
    return c.post(f"/api/appointments/{appt.id}/{action}/")


@pytest.mark.django_db
def test_doctor_marks_a_missed_visit_and_the_patient_is_told(world, django_capture_on_commit_callbacks):
    a = visit(world, -2)
    with django_capture_on_commit_callbacks(execute=True):
        r = post(world["doctor"].user, a, "no-show")
    assert r.status_code == 200
    body = r.json()
    assert (body["status"], body["no_show_by"], body["queue_status"]) == ("no_show", "doctor", "no_show")
    assert body["can_undo_no_show"] and not body["can_mark_no_show"]
    note = Notification.objects.get(user=world["patient"], kind="no_show")
    assert note.title == "Missed appointment"
    assert str(world["doctor"]) in note.message and note.link == "/patient/appointments"


@pytest.mark.django_db
def test_hospital_can_mark_even_an_auto_completed_visit(world):
    a = visit(world, -30)  # yesterday, still "confirmed"
    assert complete_past_appointments() == 1  # the hourly job can't know the patient never came
    a.refresh_from_db()
    assert a.status == "completed"
    r = post(world["manager"], a, "no-show")
    assert r.status_code == 200 and r.json()["no_show_by"] == "hospital"
    # The hourly job leaves no-shows alone.
    complete_past_appointments()
    a.refresh_from_db()
    assert a.status == "no_show"


@pytest.mark.django_db
def test_undo_turns_it_back_into_a_completed_visit(world, django_capture_on_commit_callbacks):
    a = visit(world, -2, status="no_show", no_show_by="doctor")
    with django_capture_on_commit_callbacks(execute=True):
        r = post(world["manager"], a, "undo-no-show")
    assert r.status_code == 200
    assert (r.json()["status"], r.json()["no_show_by"]) == ("completed", "")
    assert Notification.objects.filter(user=world["patient"], kind="no_show_undone").exists()
    assert post(world["manager"], a, "undo-no-show").status_code == 400  # not missed any more


@pytest.mark.django_db
@pytest.mark.parametrize("hours, status, extra, why", [
    (2, "confirmed", {}, "once its time has come"),                      # in the future
    (-24 * 8, "completed", {}, "up to 7 days"),                            # too long ago
    (-2, "cancelled", {}, "can't be marked"),
    (-2, "booked", {"awaiting_hospital": True}, "can't be marked"),        # never confirmed by the hospital
    (-2, "confirmed", {"checked_in_at": NOW - timedelta(hours=3)}, "so they came"),
    (-2, "no_show", {}, "already marked"),
])
def test_refused_when_the_rules_say_no(world, hours, status, extra, why):
    a = visit(world, hours, status=status, **extra)
    r = post(world["doctor"].user, a, "no-show") if not extra.get("awaiting_hospital") else post(world["manager"], a, "no-show")
    assert r.status_code == 400
    assert why in str(r.json())


@pytest.mark.django_db
def test_only_the_doctor_or_the_hospital_may_mark(world):
    a = visit(world, -2)
    assert post(world["patient"], a, "no-show").status_code == 403
    platform = User.objects.create_superuser("boss@example.com", "pw")
    assert post(platform, a, "no-show").status_code == 403
    # Another hospital's account doesn't even see the appointment.
    other = User.objects.create_user("desk@other.example", "pw", role="hospital")
    HospitalAdmin.objects.create(user=other, hospital=Hospital.objects.create(name="Other", city="Chennai"))
    assert post(other, a, "no-show").status_code == 404
    # The patient's own list doesn't offer the button.
    c = APIClient()
    c.force_authenticate(world["patient"])
    assert c.get("/api/appointments/?when=past").json()[0]["can_mark_no_show"] is False


@pytest.mark.django_db
def test_reports_count_no_shows_and_they_are_not_visits(world):
    visit(world, -2, status="no_show")
    visit(world, -26, status="completed")
    report = hospital_reports(world["hospital"], 3, today=NOW.date())
    assert report["totals"]["appointments"] == 2  # both were booked
    assert report["totals"]["completed"] == 1
    assert report["totals"]["no_show"] == 1
    assert report["appointments"]["no_show"][-1] == 1
    doc = report["doctors"][0]
    assert (doc["no_show"], doc["patients"]) == (1, 1)
    assert report["departments"][0]["no_show"] == 1
