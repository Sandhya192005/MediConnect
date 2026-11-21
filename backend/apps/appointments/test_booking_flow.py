"""
Booking flow (owner decisions 2026-11-21, appointments/flow.py):
- hospital request: hospital accepts & assigns a doctor → the doctor accepts or rejects (→ back to the hospital);
- personal request (or a hospital without an account): straight to the doctor, who accepts or rejects (→ declined).
"""

from datetime import time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.appointments.flow import EXPIRED_REASON, expire_unanswered
from apps.appointments.models import Appointment, DoctorRejection
from apps.doctors.models import DoctorProfile, WeeklyAvailability
from apps.hospitals.models import Hospital
from apps.notifications.models import Notification
from apps.notifications.tasks import complete_past_appointments, send_due_reminders
from apps.staff.models import HospitalAdmin

User = get_user_model()


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


def make_doctor(email, first, hospital):
    user = User.objects.create_user(email, "pw", role="doctor", first_name=first, last_name="Raman")
    doctor = DoctorProfile.objects.get(user=user)
    doctor.hospital, doctor.is_active, doctor.slot_minutes, doctor.specialization = hospital, True, 30, "Cardiologist"
    doctor.save()
    WeeklyAvailability.objects.bulk_create(
        [WeeklyAvailability(doctor=doctor, weekday=d, start_time=time(9), end_time=time(17)) for d in range(7)])
    return doctor


@pytest.fixture
def world():
    city = Hospital.objects.create(name="City Hospital", city="Chennai", is_approved=True)
    manager = User.objects.create_user("desk@city.example", "pw", role="hospital")
    HospitalAdmin.objects.create(user=manager, hospital=city)
    plain = Hospital.objects.create(name="Plain Clinic", city="Chennai", is_approved=True)  # no hospital account
    return {
        "city": city, "manager": manager,
        "priya": make_doctor("priya@example.com", "Priya", city),
        "bala": make_doctor("bala@example.com", "Bala", city),
        "solo": make_doctor("solo@example.com", "Solo", plain),
        "patient": User.objects.create_user("asha@example.com", "pw", first_name="Asha", last_name="K"),
    }


def slot(hour=10):
    day = timezone.localdate() + timedelta(days=2)
    return timezone.make_aware(timezone.datetime.combine(day, time(hour))).isoformat()


def book(world, doctor, source=None, hour=10):
    body = {"doctor": doctor.id, "start": slot(hour), "reason": "Check-up"}
    if source:
        body["source"] = source
    r = client_for(world["patient"]).post("/api/appointments/", body, format="json")
    assert r.status_code == 201, r.json()
    return r.json()


def post(user, appt_id, action, body=None):
    return client_for(user).post(f"/api/appointments/{appt_id}/{action}/", body or {}, format="json")


def doctor_list(doctor, query=""):
    return [a["id"] for a in client_for(doctor.user).get(f"/api/appointments/?{query}").json()]


def kinds(user):
    return list(Notification.objects.filter(user=user).values_list("kind", flat=True))


# ---------------------------------------------------------------- hospital request

@pytest.mark.django_db
def test_hospital_request_hospital_assigns_then_doctor_accepts(world, django_capture_on_commit_callbacks):
    priya, manager, patient = world["priya"], world["manager"], world["patient"]
    with django_capture_on_commit_callbacks(execute=True):
        a = book(world, priya, source="hospital")
    assert (a["source"], a["status"], a["awaiting_hospital"], a["awaiting_doctor"]) == ("hospital", "booked", True, False)
    assert a["id"] not in doctor_list(priya)  # the doctor doesn't see it yet
    assert "requested" in kinds(patient) and "requested" in kinds(manager)

    # The hospital accepts it for the doctor the patient chose.
    with django_capture_on_commit_callbacks(execute=True):
        r = post(manager, a["id"], "hospital-confirm")
    assert r.status_code == 200, r.json()
    assert (r.json()["awaiting_hospital"], r.json()["awaiting_doctor"], r.json()["status"]) == (False, True, "booked")
    assert a["id"] in doctor_list(priya, "awaiting=doctor")
    assert "hospital_assigned" in kinds(priya.user) and "hospital_assigned" in kinds(patient)

    # The doctor accepts: confirmed, the patient is emailed, the hospital is told.
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        r = post(priya.user, a["id"], "doctor-accept")
    assert (r.json()["status"], r.json()["awaiting_doctor"]) == ("confirmed", False)
    assert [m.to[0] for m in mail.outbox] == ["asha@example.com"] and "confirmed" in mail.outbox[0].subject
    assert "doctor_accepted" in kinds(manager)
    assert post(priya.user, a["id"], "doctor-accept").status_code == 400  # nothing left to answer


@pytest.mark.django_db
def test_a_rejection_goes_back_to_the_hospital_which_reassigns(world, django_capture_on_commit_callbacks):
    priya, bala, manager = world["priya"], world["bala"], world["manager"]
    a = book(world, priya, source="hospital")
    post(manager, a["id"], "hospital-confirm")

    assert post(priya.user, a["id"], "doctor-reject").status_code == 400  # a reason is needed
    with django_capture_on_commit_callbacks(execute=True):
        r = post(priya.user, a["id"], "doctor-reject", {"reason": "On leave that day"})
    assert (r.json()["status"], r.json()["awaiting_hospital"], r.json()["awaiting_doctor"]) == ("booked", True, False)
    note = Notification.objects.get(user=manager, kind="doctor_rejected")
    assert "On leave that day" in note.message and "Assign another doctor" in note.message
    assert not Notification.objects.filter(user=world["patient"], kind__in=["doctor_declined", "cancelled"]).exists()

    # The hospital sees who said no, and which doctors are free.
    hospital_view = client_for(manager).get(f"/api/appointments/{a['id']}/").json()
    assert hospital_view["last_rejection"]["reason"] == "On leave that day"
    options = {d["name"]: d for d in client_for(manager).get(f"/api/appointments/{a['id']}/assignable-doctors/").json()}
    assert options["Dr. Priya Raman"]["rejected"] and options["Dr. Bala Raman"]["free"]
    assert "Dr. Solo Raman" not in options  # another hospital's doctor

    # Reassign to Bala, who accepts.
    r = post(manager, a["id"], "hospital-confirm", {"doctor": bala.id})
    assert r.status_code == 200, r.json()
    assert r.json()["doctor"] == bala.id
    assert a["id"] not in doctor_list(priya) and a["id"] in doctor_list(bala, "awaiting=doctor")
    assert post(bala.user, a["id"], "doctor-accept").json()["status"] == "confirmed"

    # Doctor management: Priya's rejection is kept (now with Bala); Bala's accepted list has it.
    priya_page = client_for(manager).get(f"/api/hospital-admin/doctors/{priya.id}/appointments/").json()
    assert priya_page["counts"] == {"waiting": 0, "accepted": 0, "rejected": 1}
    assert priya_page["rejected"][0]["reason"] == "On leave that day"
    assert priya_page["rejected"][0]["now_with"] == "Dr. Bala Raman"
    bala_page = client_for(manager).get(f"/api/hospital-admin/doctors/{bala.id}/appointments/").json()
    assert [x["id"] for x in bala_page["accepted"]] == [a["id"]]
    assert client_for(manager).get(f"/api/hospital-admin/doctors/{world['solo'].id}/appointments/").status_code == 404


@pytest.mark.django_db
def test_the_hospital_can_only_assign_a_free_doctor_of_its_own(world):
    priya, bala, manager = world["priya"], world["bala"], world["manager"]
    busy = book(world, bala)  # Bala already has a (personal) request at 10:00: the slot is held
    a = book(world, priya, source="hospital")
    options = {d["name"]: d["free"] for d in client_for(manager).get(f"/api/appointments/{a['id']}/assignable-doctors/").json()}
    assert options == {"Dr. Bala Raman": False, "Dr. Priya Raman": True}
    r = post(manager, a["id"], "hospital-confirm", {"doctor": bala.id})
    assert r.status_code == 400 and "isn't free" in str(r.json())
    r = post(manager, a["id"], "hospital-confirm", {"doctor": world["solo"].id})
    assert r.status_code == 400 and "your hospital's doctors" in str(r.json())
    assert Appointment.objects.get(pk=busy["id"]).doctor_id == bala.id


@pytest.mark.django_db
def test_the_hospital_declines_with_a_reason(world, django_capture_on_commit_callbacks):
    a = book(world, world["priya"], source="hospital")
    assert post(world["manager"], a["id"], "hospital-decline").status_code == 400  # reason needed
    with django_capture_on_commit_callbacks(execute=True):
        r = post(world["manager"], a["id"], "hospital-decline", {"reason": "Doctor is on leave"})
    assert (r.json()["status"], r.json()["cancel_reason"]) == ("cancelled", "Doctor is on leave")
    assert "hospital_declined" in kinds(world["patient"])
    book(world, world["priya"], source="hospital")  # the slot is free again


# ---------------------------------------------------------------- personal request

@pytest.mark.django_db
def test_personal_request_goes_straight_to_the_doctor(world, django_capture_on_commit_callbacks):
    priya, manager = world["priya"], world["manager"]
    with django_capture_on_commit_callbacks(execute=True):
        a = book(world, priya)  # no source = personal
    assert (a["source"], a["awaiting_hospital"], a["awaiting_doctor"]) == ("personal", False, True)
    assert a["id"] in doctor_list(priya, "awaiting=doctor")
    assert "doctor_requested" in kinds(priya.user) and not kinds(manager)  # the hospital isn't asked
    assert post(manager, a["id"], "hospital-confirm").status_code == 400  # nothing for the hospital to accept
    # The hospital still sees it in its list.
    assert a["id"] in [x["id"] for x in client_for(manager).get("/api/appointments/").json()]

    # The doctor rejects: declined, the patient is told why, the slot is free again.
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        r = post(priya.user, a["id"], "doctor-reject", {"reason": "Fully booked that day"})
    assert (r.json()["status"], r.json()["cancelled_by"], r.json()["cancel_reason"]) == ("cancelled", "doctor", "Fully booked that day")
    assert "Fully booked that day" in mail.outbox[0].body
    assert DoctorRejection.objects.filter(doctor=priya).count() == 1
    book(world, priya)  # the slot can be booked again


@pytest.mark.django_db
def test_a_hospital_without_an_account_sends_hospital_requests_to_the_doctor(world):
    solo = world["solo"]
    a = book(world, solo, source="hospital")
    assert (a["source"], a["awaiting_hospital"], a["awaiting_doctor"]) == ("hospital", False, True)
    r = post(solo.user, a["id"], "doctor-reject", {"reason": "Not available"})
    assert r.json()["status"] == "cancelled"  # nobody to reassign it: declined


# ---------------------------------------------------------------- pending = not accepted yet

@pytest.mark.django_db
def test_who_may_answer(world):
    priya, bala, manager, patient = world["priya"], world["bala"], world["manager"], world["patient"]
    a = book(world, priya)
    assert post(patient, a["id"], "doctor-accept").status_code == 403
    assert post(manager, a["id"], "doctor-accept").status_code == 403
    assert post(bala.user, a["id"], "doctor-accept").status_code == 404  # not even visible to another doctor
    assert post(priya.user, a["id"], "complete").status_code == 400  # not accepted yet
    # The older "Confirm" button means Accept for a request.
    assert post(priya.user, a["id"], "confirm").json()["status"] == "confirmed"


@pytest.mark.django_db
def test_requests_get_no_reminders_or_queue_and_expire_if_nobody_answers(world, django_capture_on_commit_callbacks):
    priya, patient = world["priya"], world["patient"]
    now = timezone.now()
    soon = Appointment.objects.create(patient=patient, doctor=priya, start=now + timedelta(minutes=50),
                                      end=now + timedelta(minutes=80), awaiting_doctor=True)
    assert send_due_reminders() == 0  # no "in 1 hour" reminder for a request
    r = post(patient, soon.id, "check-in")
    assert r.status_code == 400 and "hasn't accepted" in str(r.json())

    past_doctor = Appointment.objects.create(patient=patient, doctor=priya, start=now - timedelta(hours=3),
                                             end=now - timedelta(hours=2, minutes=30), awaiting_doctor=True)
    past_hospital = Appointment.objects.create(patient=patient, doctor=priya, start=now - timedelta(hours=5),
                                               end=now - timedelta(hours=4, minutes=30), awaiting_hospital=True,
                                               source="hospital")
    assert complete_past_appointments() == 0  # never "completed" without an Accept
    with django_capture_on_commit_callbacks(execute=True):
        assert expire_unanswered() == 2
    for appt in (past_doctor, past_hospital):
        appt.refresh_from_db()
        assert (appt.status, appt.cancelled_by, appt.cancel_reason) == ("cancelled", "system", EXPIRED_REASON)
    soon.refresh_from_db()
    assert soon.status == "booked"  # its time hasn't come yet
    assert Notification.objects.filter(user=patient, kind="expired").count() == 2


@pytest.mark.django_db
def test_a_patient_cancelling_a_request_clears_it_for_the_doctor(world):
    priya = world["priya"]
    a = book(world, priya)
    r = post(world["patient"], a["id"], "cancel")
    assert (r.json()["status"], r.json()["awaiting_doctor"]) == ("cancelled", False)
    assert a["id"] not in doctor_list(priya, "awaiting=doctor")
