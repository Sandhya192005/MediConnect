"""Hospital confirms first (owner request 2026-11-18): bookings wait for the hospital before reaching the doctor."""

from datetime import time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile, WeeklyAvailability
from apps.hospitals.models import Hospital
from apps.notifications.models import Notification
from apps.staff.models import HospitalAdmin

User = get_user_model()


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def world():
    hospital = Hospital.objects.create(name="City Hospital", city="Chennai", is_approved=True)
    doc_user = User.objects.create_user("doc@example.com", "pw", role="doctor", first_name="Priya", last_name="Raman")
    doctor = DoctorProfile.objects.get(user=doc_user)
    doctor.hospital, doctor.is_active, doctor.slot_minutes = hospital, True, 30
    doctor.save()
    WeeklyAvailability.objects.bulk_create(
        [WeeklyAvailability(doctor=doctor, weekday=d, start_time=time(9), end_time=time(17)) for d in range(7)])
    manager = User.objects.create_user("manager@city.example", "pw", role="admin")
    HospitalAdmin.objects.create(user=manager, hospital=hospital)
    patient = User.objects.create_user("asha@example.com", "pw", first_name="Asha")
    return {"hospital": hospital, "doctor": doctor, "doc_user": doc_user, "manager": manager, "patient": patient}


def slot(hour=10):
    day = timezone.localdate() + timedelta(days=2)
    return timezone.make_aware(timezone.datetime.combine(day, time(hour))).isoformat()


def book(world, hour=10, capture=None):
    return client_for(world["patient"]).post("/api/appointments/", {"doctor": world["doctor"].id, "start": slot(hour),
                                                                     "reason": "Check-up"}, format="json")


@pytest.mark.django_db
def test_a_booking_waits_for_the_hospital_then_reaches_the_doctor(world, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        r = book(world)
    assert r.status_code == 201, r.json()
    appt = r.json()
    assert (appt["status"], appt["awaiting_hospital"]) == ("booked", True)

    # Who was told: the patient ("waiting") and the hospital, not the doctor.
    assert Notification.objects.filter(user=world["patient"], kind="requested").exists()
    assert Notification.objects.filter(user=world["manager"], kind="requested").exists()
    assert not Notification.objects.filter(user=world["doc_user"]).exists()
    assert [m.to for m in mail.outbox] == [["asha@example.com"]]

    # The slot is held: nobody else can take it.
    other = User.objects.create_user("ravi@example.com", "pw")
    taken = client_for(other).post("/api/appointments/", {"doctor": world["doctor"].id, "start": slot()}, format="json")
    assert taken.status_code == 400

    # The doctor doesn't see it yet; the hospital does, under "to confirm".
    assert client_for(world["doc_user"]).get("/api/appointments/").json() == []
    hosp = client_for(world["manager"])
    assert [a["id"] for a in hosp.get("/api/appointments/?awaiting=1").json()] == [appt["id"]]
    assert hosp.get("/api/hospital-admin/overview/").json()["counts"]["to_confirm"] == 1

    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        r = hosp.post(f"/api/appointments/{appt['id']}/hospital-confirm/")
    assert (r.json()["status"], r.json()["awaiting_hospital"]) == ("confirmed", False)
    assert Notification.objects.filter(user=world["doc_user"], kind="hospital_confirmed").exists()
    assert Notification.objects.filter(user=world["patient"], kind="hospital_confirmed").exists()
    assert sorted(m.to[0] for m in mail.outbox) == ["asha@example.com", "doc@example.com"]
    assert [a["id"] for a in client_for(world["doc_user"]).get("/api/appointments/").json()] == [appt["id"]]
    # Confirming twice is refused.
    assert hosp.post(f"/api/appointments/{appt['id']}/hospital-confirm/").status_code == 400


@pytest.mark.django_db
def test_a_decline_needs_a_reason_frees_the_slot_and_tells_the_patient(world, django_capture_on_commit_callbacks):
    appt = book(world).json()
    hosp = client_for(world["manager"])
    assert "reason" in hosp.post(f"/api/appointments/{appt['id']}/hospital-decline/", {}, format="json").json()

    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        r = hosp.post(f"/api/appointments/{appt['id']}/hospital-decline/", {"reason": "The doctor is on leave"}, format="json")
    assert (r.json()["status"], r.json()["cancelled_by"], r.json()["cancel_reason"]) == ("cancelled", "hospital", "The doctor is on leave")
    note = Notification.objects.get(user=world["patient"], kind="hospital_declined")
    assert "on leave" in note.message
    assert "on leave" in mail.outbox[0].body
    assert not Notification.objects.filter(user=world["doc_user"]).exists()
    assert client_for(world["doc_user"]).get("/api/appointments/").json() == []  # never in the doctor's list
    # The slot is free again.
    assert book(world).status_code == 201


@pytest.mark.django_db
def test_a_patient_cancelling_an_unconfirmed_booking_tells_the_hospital_not_the_doctor(world, django_capture_on_commit_callbacks):
    appt = book(world).json()
    with django_capture_on_commit_callbacks(execute=True):
        client_for(world["patient"]).post(f"/api/appointments/{appt['id']}/cancel/")
    assert Notification.objects.filter(user=world["manager"], kind="request_cancelled").exists()
    assert not Notification.objects.filter(user=world["doc_user"]).exists()
    assert client_for(world["doc_user"]).get("/api/appointments/").json() == []


@pytest.mark.django_db
def test_hospitals_without_an_account_or_with_the_switch_off_go_straight_to_the_doctor(world, django_capture_on_commit_callbacks):
    hosp = client_for(world["manager"])
    assert hosp.patch("/api/hospital-admin/booking-settings/", {"confirm_bookings": False}, format="json").json() == {"confirm_bookings": False}
    with django_capture_on_commit_callbacks(execute=True):
        appt = book(world, hour=11).json()
    assert (appt["status"], appt["awaiting_hospital"]) == ("booked", False)
    assert Notification.objects.filter(user=world["doc_user"], kind="booked").exists()

    hosp.patch("/api/hospital-admin/booking-settings/", {"confirm_bookings": True}, format="json")
    HospitalAdmin.objects.all().delete()  # no hospital account at all: today's flow
    assert book(world, hour=12).json()["awaiting_hospital"] is False
    assert hosp.patch("/api/hospital-admin/booking-settings/", {"confirm_bookings": "yes"}, format="json").status_code == 403


@pytest.mark.django_db
def test_only_the_hospitals_own_admins_confirm_and_unconfirmed_visits_have_no_queue_or_reminders(world):
    appt = book(world).json()
    other_admin = User.objects.create_user("other@example.com", "pw", role="admin")
    HospitalAdmin.objects.create(user=other_admin, hospital=Hospital.objects.create(name="Other", city="Chennai"))
    for user in (other_admin, world["doc_user"], world["patient"]):
        assert client_for(user).post(f"/api/appointments/{appt['id']}/hospital-confirm/").status_code in (403, 404)

    # Not in the doctor's queue, can't check in, no reminders, never auto-completed.
    a = Appointment.objects.get(pk=appt["id"])
    from apps.appointments import queue
    from apps.notifications.tasks import complete_past_appointments, send_due_reminders

    a.start = timezone.now() + timedelta(minutes=30)
    a.end = a.start + timedelta(minutes=30)
    a.save()
    assert not queue.appointments_on(a.doctor_id).filter(pk=a.pk).exists()
    assert "hasn't confirmed" in str(client_for(world["patient"]).post(f"/api/appointments/{a.pk}/check-in/").json())
    send_due_reminders()
    a.refresh_from_db()
    assert a.reminder_1h_sent_at is None
    Appointment.objects.filter(pk=a.pk).update(start=timezone.now() - timedelta(hours=3), end=timezone.now() - timedelta(hours=2))
    complete_past_appointments()
    a.refresh_from_db()
    assert a.status == "booked"


@pytest.mark.django_db
def test_appointments_carry_the_hospitals_place_for_directions(world):
    from django.contrib.gis.geos import Point

    world["hospital"].address, world["hospital"].phone = "Lake Road, Anna Nagar", "044 1234"
    world["hospital"].location, world["hospital"].location_verified = Point(80.21, 13.08, srid=4326), True
    world["hospital"].save()
    appt = book(world).json()
    assert appt["hospital"] == {"id": world["hospital"].id, "address": "Lake Road, Anna Nagar", "city": "Chennai",
                                "phone": "044 1234", "latitude": 13.08, "longitude": 80.21, "location_verified": True}
