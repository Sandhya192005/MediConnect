from datetime import time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile, WeeklyAvailability
from apps.hospitals.models import Hospital

from .tasks import complete_past_appointments, send_due_reminders

User = get_user_model()


@pytest.fixture
def doctor():
    user = User.objects.create_user("doc@example.com", "pw", role="doctor", first_name="Doc")
    profile = DoctorProfile.objects.get(user=user)
    profile.hospital = Hospital.objects.create(name="Test Hospital", city="Chennai")
    profile.save()
    for wd in range(7):
        WeeklyAvailability.objects.create(doctor=profile, weekday=wd, start_time=time(0), end_time=time(23, 45))
    return profile


@pytest.fixture
def patient():
    return User.objects.create_user("pat@example.com", "pw", first_name="Pat")


def make_appt(doctor, patient, starts_in, created_ago=timedelta(days=3)):
    start = timezone.now() + starts_in
    appt = Appointment.objects.create(doctor=doctor, patient=patient, start=start, end=start + timedelta(minutes=15))
    Appointment.objects.filter(pk=appt.pk).update(created_at=timezone.now() - created_ago)
    return appt


@pytest.mark.django_db
def test_booking_emails_patient_and_doctor(doctor, patient, django_capture_on_commit_callbacks):
    c = APIClient()
    c.force_authenticate(patient)
    day = (timezone.localdate() + timedelta(days=2)).isoformat()
    slot = c.get(f"/api/doctors/{doctor.id}/slots/?date={day}").data["slots"][4]["start"]

    with django_capture_on_commit_callbacks(execute=True):
        res = c.post("/api/appointments/", {"doctor": doctor.id, "start": slot}, format="json")
    assert res.status_code == 201

    assert sorted(m.to[0] for m in mail.outbox) == ["doc@example.com", "pat@example.com"]
    assert "Appointment booked" in mail.outbox[0].subject
    assert mail.outbox[0].alternatives  # has an HTML version too

    # Cancelling sends another pair
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        c.post(f"/api/appointments/{res.data['id']}/cancel/")
    assert len(mail.outbox) == 2
    assert "cancelled" in mail.outbox[0].subject


@pytest.mark.django_db
def test_slots_cache_is_refreshed_after_booking(doctor, patient, django_capture_on_commit_callbacks):
    c = APIClient()
    c.force_authenticate(patient)
    day = (timezone.localdate() + timedelta(days=2)).isoformat()
    slot = c.get(f"/api/doctors/{doctor.id}/slots/?date={day}").data["slots"][4]  # now cached
    assert slot["available"]
    with django_capture_on_commit_callbacks(execute=True):
        c.post("/api/appointments/", {"doctor": doctor.id, "start": slot["start"]}, format="json")
    assert c.get(f"/api/doctors/{doctor.id}/slots/?date={day}").data["slots"][4]["available"] is False


@pytest.mark.django_db
def test_reminders_sent_once(doctor, patient):
    make_appt(doctor, patient, starts_in=timedelta(hours=20))   # due for 24h reminder
    make_appt(doctor, patient, starts_in=timedelta(minutes=40))  # due for 24h + 1h reminders
    make_appt(doctor, patient, starts_in=timedelta(days=3))      # not due yet

    assert send_due_reminders() == 3
    subjects = sorted(m.subject for m in mail.outbox)
    assert sum("tomorrow" in s for s in subjects) == 2
    assert sum("1 hour" in s for s in subjects) == 1

    mail.outbox.clear()
    assert send_due_reminders() == 0  # nothing sent twice
    assert mail.outbox == []


@pytest.mark.django_db
def test_no_24h_reminder_for_last_minute_booking(doctor, patient):
    make_appt(doctor, patient, starts_in=timedelta(hours=5), created_ago=timedelta(minutes=10))
    assert send_due_reminders() == 0


@pytest.mark.django_db
def test_past_appointments_completed(doctor, patient):
    old = make_appt(doctor, patient, starts_in=-timedelta(hours=3))
    future = make_appt(doctor, patient, starts_in=timedelta(hours=3))
    assert complete_past_appointments() == 1
    old.refresh_from_db()
    future.refresh_from_db()
    assert old.status == "completed"
    assert future.status == "booked"


# ---- deleting notifications ----------------------------------------------------------

def _note(user, title="Hi", read=False):
    from .models import Notification

    return Notification.objects.create(user=user, kind="test", title=title, message="m", is_read=read)


def test_delete_one_notification(db):
    from .models import Notification

    me = User.objects.create_user("me@x.com", "pw", role="patient")
    other = User.objects.create_user("other@x.com", "pw", role="patient")
    unread, read, theirs = _note(me, "a"), _note(me, "b", read=True), _note(other, "c")
    c = APIClient()
    c.force_authenticate(me)

    res = c.delete(f"/api/notifications/{unread.id}/")
    assert res.status_code == 200 and res.data["unread"] == 0
    assert not Notification.objects.filter(pk=unread.pk).exists()
    assert c.delete(f"/api/notifications/{theirs.id}/").status_code == 404  # never someone else's
    assert Notification.objects.filter(pk=theirs.pk).exists()
    assert c.get("/api/notifications/").data["results"][0]["id"] == read.id


def test_clear_all_only_clears_mine(db):
    from .models import Notification

    me = User.objects.create_user("me@x.com", "pw", role="patient")
    other = User.objects.create_user("other@x.com", "pw", role="patient")
    _note(me), _note(me, read=True), _note(other)
    c = APIClient()
    c.force_authenticate(me)
    res = c.post("/api/notifications/clear/")
    assert res.status_code == 200 and res.data == {"unread": 0, "deleted": 2}
    assert Notification.objects.filter(user=me).count() == 0
    assert Notification.objects.filter(user=other).count() == 1
    assert APIClient().post("/api/notifications/clear/").status_code == 401  # must be logged in
