from datetime import time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.doctors.models import DoctorProfile, WeeklyAvailability
from apps.hospitals.models import Hospital
from apps.notifications.models import Notification
from apps.notifications.tasks import send_due_reminders

from .models import Appointment, ExternalAppointment

User = get_user_model()


@pytest.fixture
def patient(db):
    return User.objects.create_user("pat@x.com", "pw", first_name="Pat")


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


def in_(**kw):
    return (timezone.now() + timedelta(**kw)).isoformat()


def test_add_list_and_label(patient):
    h = Hospital.objects.create(name="Greenfield", city="Chennai", source="scraped", is_approved=False)
    c = client_for(patient)
    res = c.post("/api/external-appointments/", {"hospital": h.id, "doctor_name": "Dr. Farhan Ali", "start": in_(days=3)}, format="json")
    assert res.status_code == 201
    assert res.data["display_hospital"] == "Greenfield"
    assert res.data["label"] == "Booked directly with the hospital – added by you"

    res = c.post("/api/external-appointments/", {"hospital_name": "Some Clinic, Madurai", "start": in_(days=5)}, format="json")
    assert res.status_code == 201
    assert len(c.get("/api/external-appointments/?when=upcoming").data) == 2
    assert Appointment.objects.count() == 0  # never a MediConnect booking


def test_validation(patient):
    c = client_for(patient)
    assert c.post("/api/external-appointments/", {"start": in_(days=2)}, format="json").status_code == 400  # no hospital
    assert c.post("/api/external-appointments/", {"hospital_name": "X", "start": in_(hours=-1)}, format="json").status_code == 400
    assert c.post("/api/external-appointments/", {"hospital_name": "X", "start": in_(days=400)}, format="json").status_code == 400
    doctor = User.objects.create_user("doc@x.com", "pw", role="doctor")
    assert client_for(doctor).post("/api/external-appointments/", {"hospital_name": "X", "start": in_(days=2)}, format="json").status_code == 403


def test_private_to_patient(patient):
    ext_id = client_for(patient).post("/api/external-appointments/", {"hospital_name": "X", "start": in_(days=2)}, format="json").data["id"]
    other = User.objects.create_user("o@x.com", "pw")
    assert client_for(other).get("/api/external-appointments/").data == []
    assert client_for(other).delete(f"/api/external-appointments/{ext_id}/").status_code == 404


def test_reminders_sent_once_and_not_after_cancel(patient):
    def make(starts_in, created_ago=timedelta(days=3)):
        e = ExternalAppointment.objects.create(patient=patient, hospital_name="Greenfield", start=timezone.now() + starts_in)
        ExternalAppointment.objects.filter(pk=e.pk).update(created_at=timezone.now() - created_ago)
        return e

    make(timedelta(hours=20))                                          # 24h reminder
    make(timedelta(minutes=40))                                        # 24h + 1h reminders
    make(timedelta(hours=5), created_ago=timedelta(minutes=5))         # added last-minute: no 24h reminder
    cancelled = make(timedelta(hours=10))
    cancelled.status = "cancelled"
    cancelled.save()

    assert send_due_reminders() == 3
    assert len(mail.outbox) == 3
    assert "booked this directly with the hospital" in mail.outbox[0].body
    assert Notification.objects.filter(user=patient).count() == 3

    mail.outbox.clear()
    assert send_due_reminders() == 0  # never twice


def test_moving_time_resets_reminders(patient):
    e = ExternalAppointment.objects.create(patient=patient, hospital_name="X", start=timezone.now() + timedelta(hours=10),
                                           reminder_24h_sent_at=timezone.now())
    client_for(patient).patch(f"/api/external-appointments/{e.id}/", {"start": in_(days=2)}, format="json")
    e.refresh_from_db()
    assert e.reminder_24h_sent_at is None


def test_does_not_block_mediconnect_slots(patient):
    user = User.objects.create_user("d@x.com", "pw", role="doctor")
    doc = DoctorProfile.objects.get(user=user)
    doc.hospital = Hospital.objects.create(name="Partner", city="Chennai")
    doc.save()
    for wd in range(7):
        WeeklyAvailability.objects.create(doctor=doc, weekday=wd, start_time=time(9), end_time=time(10))
    day = (timezone.localdate() + timedelta(days=2)).isoformat()
    first = APIClient().get(f"/api/doctors/{doc.id}/slots/?date={day}").data["slots"][0]["start"]
    client_for(patient).post("/api/external-appointments/", {"hospital": doc.hospital.id, "start": first}, format="json")
    assert APIClient().get(f"/api/doctors/{doc.id}/slots/?date={day}").data["slots"][0]["available"] is True
