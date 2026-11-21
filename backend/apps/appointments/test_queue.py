"""Patient queue (Step 3): check-in, tokens, call-in, people ahead, and the hourly auto-complete."""

from datetime import datetime, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile
from apps.hospitals.models import Hospital
from apps.notifications.models import Notification

User = get_user_model()
NOON = timezone.make_aware(datetime(2026, 11, 18, 12, 0))  # Asia/Kolkata


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    """Every test runs at 12:00 noon India time, so 'today' and the check-in window never depend on when CI runs."""
    monkeypatch.setattr(timezone, "now", lambda: NOON)


@pytest.fixture
def doctor():
    user = User.objects.create_user("doc@example.com", "pw", role="doctor", first_name="Priya", last_name="Raman")
    profile = DoctorProfile.objects.get(user=user)
    profile.hospital = Hospital.objects.create(name="City Hospital", city="Chennai")
    profile.save()
    return profile


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


def visit(doctor, name, minutes_from_noon, status="booked"):
    patient = User.objects.create_user(f"{name}@example.com", "pw", first_name=name.title(), last_name="P")
    start = NOON + timedelta(minutes=minutes_from_noon)
    return Appointment.objects.create(patient=patient, doctor=doctor, start=start, end=start + timedelta(minutes=15),
                                      status=status)


def post(user, appt, action):
    return client_for(user).post(f"/api/appointments/{appt.id}/{action}/")


@pytest.mark.django_db
def test_checking_in_gives_tokens_in_arrival_order_and_tells_the_doctor(doctor, django_capture_on_commit_callbacks):
    a, b = visit(doctor, "asha", 30), visit(doctor, "ravi", 15)
    with django_capture_on_commit_callbacks(execute=True):
        r1 = post(a.patient, a, "check-in")
        r2 = post(b.patient, b, "check-in")
    assert r1.status_code == r2.status_code == 200
    assert (r1.json()["token"], r1.json()["queue_status"]) == (1, "waiting")
    assert r2.json()["token"] == 2  # arrival order, not booking time

    note = Notification.objects.filter(user=doctor.user, kind="checked_in").first()
    assert note and "token 1" in note.message and note.link == "/doctor/queue"


@pytest.mark.django_db
def test_checking_in_twice_keeps_the_same_token(doctor):
    a = visit(doctor, "asha", 30)
    post(a.patient, a, "check-in")
    assert post(a.patient, a, "check-in").json()["token"] == 1
    a.refresh_from_db()
    assert a.token == 1


@pytest.mark.django_db
def test_patients_can_check_in_from_two_hours_before_but_the_doctor_any_time(doctor):
    early = visit(doctor, "asha", 180)  # 3:00 pm: check-in opens at 1:00 pm
    r = post(early.patient, early, "check-in")
    assert r.status_code == 400 and "Check-in opens at 1:00 PM" in str(r.json())
    assert post(doctor.user, early, "check-in").status_code == 200


@pytest.mark.django_db
def test_no_check_in_on_another_day_or_for_cancelled_visits(doctor):
    tomorrow = visit(doctor, "asha", 24 * 60)
    assert "day of the appointment" in str(post(tomorrow.patient, tomorrow, "check-in").json())
    cancelled = visit(doctor, "ravi", 30, status="cancelled")
    assert post(cancelled.patient, cancelled, "check-in").status_code == 400


@pytest.mark.django_db
def test_nobody_else_can_check_a_patient_in(doctor):
    a = visit(doctor, "asha", 30)
    other_patient = User.objects.create_user("other@example.com", "pw")
    other_doctor = User.objects.create_user("doc2@example.com", "pw", role="doctor")
    admin = User.objects.create_user("admin@example.com", "pw", role="admin")
    assert post(other_patient, a, "check-in").status_code == 404
    assert post(other_doctor, a, "check-in").status_code == 404
    assert post(admin, a, "check-in").status_code == 403
    assert post(a.patient, a, "call-in").status_code == 403  # patients can't call themselves in


@pytest.mark.django_db
def test_doctor_calls_patients_in_one_at_a_time(doctor, django_capture_on_commit_callbacks):
    a, b = visit(doctor, "asha", 0), visit(doctor, "ravi", 15)
    assert "hasn't checked in" in str(post(doctor.user, a, "call-in").json())
    post(a.patient, a, "check-in")
    post(b.patient, b, "check-in")

    with django_capture_on_commit_callbacks(execute=True):
        r = post(doctor.user, a, "call-in")
    assert r.status_code == 200 and r.json()["queue_status"] == "in_consultation"
    note = Notification.objects.get(user=a.patient, kind="called_in")
    assert note.title == "It's your turn"

    blocked = post(doctor.user, b, "call-in")
    assert blocked.status_code == 400 and "Token 1 is still in consultation" in str(blocked.json())

    assert post(doctor.user, a, "complete").json()["queue_status"] == "done"
    assert post(doctor.user, b, "call-in").status_code == 200


@pytest.mark.django_db
def test_database_refuses_two_consultations_at_once(doctor):
    from django.db import IntegrityError, transaction

    a, b = visit(doctor, "asha", 0), visit(doctor, "ravi", 15)
    Appointment.objects.filter(pk=a.pk).update(checked_in_at=NOON, token=1, consultation_started_at=NOON)
    with pytest.raises(IntegrityError), transaction.atomic():
        Appointment.objects.filter(pk=b.pk).update(checked_in_at=NOON, token=2, consultation_started_at=NOON)


@pytest.mark.django_db
def test_patients_see_how_many_people_are_ahead(doctor):
    a, b, c = visit(doctor, "asha", 0), visit(doctor, "ravi", 15), visit(doctor, "meena", 30)
    for v in (a, b, c):
        post(v.patient, v, "check-in")
    post(doctor.user, a, "call-in")

    def ahead(v):
        return client_for(v.patient).get(f"/api/appointments/{v.id}/").json()["people_ahead"]

    assert ahead(a) is None  # in consultation: no longer waiting
    assert ahead(b) == 1  # token 1 is in with the doctor
    assert ahead(c) == 2


@pytest.mark.django_db
def test_queue_groups_the_doctors_day(doctor):
    a, b, c, d = visit(doctor, "asha", 0), visit(doctor, "ravi", 15), visit(doctor, "meena", 30), visit(doctor, "kumar", 45)
    visit(doctor, "gone", 60, status="cancelled")
    visit(doctor, "next", 24 * 60)  # tomorrow
    post(c.patient, c, "check-in")  # token 1
    post(b.patient, b, "check-in")  # token 2
    post(a.patient, a, "check-in")  # token 3
    post(doctor.user, c, "call-in")
    post(doctor.user, c, "complete")
    post(doctor.user, b, "call-in")

    r = client_for(doctor.user).get("/api/appointments/queue/")
    assert r.status_code == 200
    q = r.json()
    names = {k: [x["patient_name"] for x in q[k]] for k in ("in_consultation", "waiting", "not_arrived", "done")}
    assert names == {"in_consultation": ["Ravi P"], "waiting": ["Asha P"], "not_arrived": ["Kumar P"], "done": ["Meena P"]}
    assert q["date"] == "2026-11-18"
    assert q["waiting"][0]["patient_id"].startswith("P")  # so the doctor can open the patient's records
    assert client_for(a.patient).get("/api/appointments/queue/").status_code == 403


@pytest.mark.django_db
def test_hourly_auto_complete_leaves_patients_still_in_todays_queue(doctor):
    from apps.notifications.tasks import complete_past_appointments

    waiting = visit(doctor, "asha", -180)  # 9:00, ended 9:15, but checked in and still waiting
    no_show = visit(doctor, "ravi", -165)  # never checked in
    Appointment.objects.filter(pk=waiting.pk).update(checked_in_at=NOON - timedelta(hours=3), token=1)
    yesterday = visit(doctor, "meena", -24 * 60)
    Appointment.objects.filter(pk=yesterday.pk).update(checked_in_at=NOON - timedelta(days=1), token=1)

    complete_past_appointments()
    status = dict(Appointment.objects.values_list("id", "status"))
    assert status[waiting.id] == "booked"
    assert status[no_show.id] == "completed"
    assert status[yesterday.id] == "completed"  # yesterday's queue is closed
