"""Requests for doctors a hospital added itself (phase 2, owner request 2026-11-26): the patient asks for
Shiva (neurology, no account); the hospital confirms him, gives the visit to another neurologist, or
declines with a reason."""

from datetime import date, timedelta

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.appointments.models import AppointmentRequest
from apps.hospitals.models import Department, Hospital
from apps.notifications.models import Notification

from .models import HospitalAdmin, StaffMember

User = get_user_model()
URL = "/api/appointment-requests/"
TOMORROW = (date.today() + timedelta(days=1)).isoformat()


def staff(hospital, name, dept=None, **extra):
    return StaffMember.objects.create(hospital=hospital, kind="doctor", full_name=name, department=dept,
                                      join_date=date(2024, 1, 1), monthly_salary=50000, **extra)


def client(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def world(db):
    neuro = Department.objects.create(name="Neurology")
    abc = Hospital.objects.create(name="ABC Hospital", city="Chennai", phone="99520 45782")
    other = Hospital.objects.create(name="Other Hospital", city="Chennai")
    hosp_user = User.objects.create_user("abc@x.com", "pw", role="hospital", first_name="ABC Hospital")
    HospitalAdmin.objects.create(user=hosp_user, hospital=abc)
    other_user = User.objects.create_user("other@x.com", "pw", role="hospital")
    HospitalAdmin.objects.create(user=other_user, hospital=other)
    w = type("W", (), {})()
    w.abc, w.hosp, w.other_hosp = abc, client(hosp_user), client(other_user)
    w.hosp_user = hosp_user
    w.patient_user = User.objects.create_user("p@x.com", "pw", role="patient", first_name="Priya")
    w.patient = client(w.patient_user)
    w.platform = client(User.objects.create_superuser("root@x.com", "pw"))
    w.shiva = staff(abc, "Shiva", neuro, specialization="Clinical Neurology")
    w.ravi = staff(abc, "Dr. Ravi", neuro)
    w.left = staff(abc, "Old Doctor", neuro, left_on=date.today() - timedelta(days=1))
    return w


def ask(w, doctor=None, **extra):
    return w.patient.post(URL, {"hospital": w.abc.id, "staff_doctor": (doctor or w.shiva).id,
                                "preferred_date": TOMORROW, "preferred_time": "Morning", "reason": "Headaches",
                                **extra}, format="json")


def test_patient_requests_a_hospital_added_doctor(world):
    res = ask(world)
    assert res.status_code == 201, res.data
    assert res.data["status"] == "pending" and res.data["for_hospital"] is True
    assert (res.data["doctor_name"], res.data["doctor_department"]) == ("Dr. Shiva", "Neurology")
    note = Notification.objects.get(user=world.hosp_user, kind="request_new")
    assert "Dr. Shiva (Neurology)" in note.message
    # Only that hospital sees it; the platform admin answers website hospitals only.
    assert [r["id"] for r in world.hosp.get(URL).data] == [res.data["id"]]
    assert world.other_hosp.get(URL).data == []
    assert world.platform.get(URL).data == []


def test_only_visible_doctors_can_be_requested(world):
    assert ask(world, world.left).status_code == 400  # has left
    world.abc.is_approved = False
    world.abc.save()
    assert ask(world).status_code == 400  # hospital not connected


def test_hospital_confirms_the_doctor_asked_for(world):
    rid = ask(world).data["id"]
    res = world.hosp.post(f"{URL}{rid}/hospital-confirm/", {"time": "10:30"}, format="json")
    assert res.status_code == 200, res.data
    assert (res.data["status"], res.data["confirmed_date"], res.data["confirmed_time"]) == ("confirmed", TOMORROW, "10:30:00")
    assert (res.data["assigned_doctor_name"], res.data["reassigned"]) == ("Dr. Shiva", False)
    note = Notification.objects.get(user=world.patient_user, kind="request_confirmed")
    assert "Dr. Shiva (Neurology)" in note.message and "10:30 AM" in note.message


def test_hospital_gives_the_visit_to_another_neurologist(world):
    rid = ask(world).data["id"]
    res = world.hosp.post(f"{URL}{rid}/hospital-confirm/", {"doctor": world.ravi.id, "time": "11:00"}, format="json")
    assert res.status_code == 200, res.data
    assert (res.data["assigned_doctor_name"], res.data["assigned_department"], res.data["reassigned"]) == ("Dr. Ravi", "Neurology", True)
    note = Notification.objects.get(user=world.patient_user, kind="request_confirmed")
    assert "Dr. Ravi (Neurology)" in note.message and "Dr. Shiva isn't available" in note.message


def test_decline_needs_a_reason_the_patient_can_read(world):
    rid = ask(world).data["id"]
    assert world.hosp.post(f"{URL}{rid}/hospital-decline/", {"reason": ""}, format="json").status_code == 400
    res = world.hosp.post(f"{URL}{rid}/hospital-decline/", {"reason": "No neurologist is available that week"}, format="json")
    assert res.status_code == 200 and res.data["status"] == "declined"
    note = Notification.objects.get(user=world.patient_user, kind="request_declined")
    assert "No neurologist is available that week" in note.message
    assert world.patient.get(f"{URL}{rid}/").data["admin_note"] == "No neurologist is available that week"


def test_confirm_checks(world):
    rid = ask(world).data["id"]
    confirm = lambda c, **body: c.post(f"{URL}{rid}/hospital-confirm/", body, format="json")  # noqa: E731
    assert confirm(world.hosp).status_code == 400                                    # no time
    assert confirm(world.hosp, time="09:00", date=date.today().isoformat()).status_code in (200, 400)  # today: ok only if still ahead
    AppointmentRequest.objects.filter(pk=rid).update(status="pending", assigned_doctor=None)
    assert confirm(world.hosp, time="10:00", doctor=world.left.id).status_code == 400  # has left
    assert confirm(world.other_hosp, time="10:00").status_code == 404               # another hospital
    assert confirm(world.patient, time="10:00").status_code == 403                  # the patient
    assert confirm(world.platform, time="10:00").status_code == 403                 # the platform admin


def test_same_doctor_same_time_only_once(world):
    first = ask(world).data["id"]
    later = (date.today() + timedelta(days=2)).isoformat()
    second = ask(world, preferred_date=later, reason="Another").data["id"]
    assert world.hosp.post(f"{URL}{first}/hospital-confirm/", {"time": "10:00"}, format="json").status_code == 200
    # The hospital moves the second request to the same day and time: refused.
    res = world.hosp.post(f"{URL}{second}/hospital-confirm/", {"time": "10:00", "date": TOMORROW}, format="json")
    assert res.status_code == 400 and "already has a visit" in str(res.data)


def test_patient_cancel_tells_the_hospital(world):
    rid = ask(world).data["id"]
    assert world.patient.post(f"{URL}{rid}/cancel/").status_code == 200
    assert Notification.objects.filter(user=world.hosp_user, kind="request_cancelled").exists()
    assert world.hosp.post(f"{URL}{rid}/hospital-confirm/", {"time": "10:00"}, format="json").status_code == 400
