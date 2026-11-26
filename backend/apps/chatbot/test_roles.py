"""The chatbot answers by role (owner request 2026-11-26): own instructions, own guide, own read-only tools."""

import json
from datetime import datetime, time, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.appointments.models import Appointment, AppointmentRequest
from apps.billing.models import PaymentSlip
from apps.doctors.models import DoctorProfile, WeeklyAvailability
from apps.hospitals.models import Hospital
from apps.staff.models import HospitalAdmin

from . import roles, service
from .tests import answer, tool_call
from .tools import ToolContext, run_tool, specs_for

User = get_user_model()


def at(day, hour, minute=0):
    return timezone.make_aware(datetime.combine(day, time(hour, minute)))


@pytest.fixture
def people(db):
    hospital = Hospital.objects.create(name="ABC Hospital", city="Chennai")
    doc_user = User.objects.create_user("doc@x.com", "pw", role="doctor", first_name="Jeevitha", last_name="D")
    doctor = DoctorProfile.objects.get(user=doc_user)
    doctor.hospital, doctor.specialization, doctor.fee = hospital, "ENT", 500
    doctor.save()
    WeeklyAvailability.objects.create(doctor=doctor, weekday=0, start_time=time(9), end_time=time(13))
    hosp_user = User.objects.create_user("abc@x.com", "pw", role="hospital", first_name="ABC Hospital")
    HospitalAdmin.objects.create(user=hosp_user, hospital=hospital)
    return {
        "hospital": hospital, "doctor": doctor, "doctor_user": doc_user, "hospital_user": hosp_user,
        "patient": User.objects.create_user("pat@x.com", "pw", role="patient", first_name="Priya", last_name="K"),
        "platform": User.objects.create_superuser("root@x.com", "pw"),
    }


def names(role):
    return {t["function"]["name"] for t in specs_for(role)}


def test_each_role_gets_its_own_tools_and_instructions(people):
    p = people
    assert [roles.role_of(p[k]) for k in ("patient", "doctor_user", "hospital_user", "platform")] == \
        [roles.PATIENT, roles.DOCTOR, roles.HOSPITAL, roles.PLATFORM]
    assert {"search_doctors", "propose_booking", "my_requests", "my_payments"} <= names(roles.PATIENT)
    assert names(roles.DOCTOR) == {"my_schedule", "my_appointments", "requests_waiting_for_me", "my_working_hours"}
    assert names(roles.HOSPITAL) == set() and names(roles.PLATFORM) == set()  # phases 2 and 3

    doctor_prompt = service.system_prompt(p["doctor_user"], has_location=False)
    assert "a DOCTOR" in doctor_prompt and "Patient queue" in doctor_prompt and "READ-ONLY" in doctor_prompt
    assert "propose_booking" not in doctor_prompt and "Share my location" not in doctor_prompt
    hospital_prompt = service.system_prompt(p["hospital_user"], has_location=False)
    assert "HOSPITAL account" in hospital_prompt and "Doctor management" in hospital_prompt
    assert "never guess a number" in hospital_prompt  # no data tools yet
    assert "PLATFORM ADMIN" in service.system_prompt(p["platform"], has_location=False)
    assert "propose_booking" in service.system_prompt(p["patient"], has_location=False)


def test_a_role_cannot_run_another_roles_tool(people):
    as_doctor = ToolContext(people["doctor_user"])
    assert "isn't available" in run_tool(as_doctor, "propose_booking", json.dumps({"doctor_id": 1, "start": "x"}))
    assert "isn't available" in run_tool(as_doctor, "my_payments", "{}")
    as_patient = ToolContext(people["patient"])
    assert "isn't available" in run_tool(as_patient, "my_schedule", "{}")
    assert "isn't available" in run_tool(ToolContext(people["hospital_user"]), "my_appointments", "{}")


def test_doctor_schedule_queue_and_requests(people):
    p, today = people, timezone.localdate()
    second = User.objects.create_user("p2@x.com", "pw", role="patient", first_name="Ravi")
    Appointment.objects.create(patient=p["patient"], doctor=p["doctor"], start=at(today, 10), end=at(today, 10, 15),
                               status="confirmed", checked_in_at=timezone.now(), token=2)
    Appointment.objects.create(patient=second, doctor=p["doctor"], start=at(today, 11), end=at(today, 11, 15),
                               status="confirmed", checked_in_at=timezone.now(), token=1)
    tomorrow = today + timedelta(days=1)
    Appointment.objects.create(patient=second, doctor=p["doctor"], start=at(tomorrow, 9), end=at(tomorrow, 9, 15),
                               status="booked", awaiting_doctor=True, reason="Ear pain")
    # Still waiting for the hospital: the doctor must not see it, in the app or in the chat.
    Appointment.objects.create(patient=p["patient"], doctor=p["doctor"], start=at(tomorrow, 10), end=at(tomorrow, 10, 15),
                               status="booked", awaiting_hospital=True)

    ctx = ToolContext(p["doctor_user"])
    day = json.loads(run_tool(ctx, "my_schedule", "{}"))
    assert day["total"] == 2 and day["counts"]["waiting"] == 2
    assert day["next_patient"]["patient"] == "Ravi" and day["next_patient"]["token"] == 1
    waiting = json.loads(run_tool(ctx, "requests_waiting_for_me", "{}"))["waiting_for_you"]
    assert [w["reason"] for w in waiting] == ["Ear pain"]
    upcoming = json.loads(run_tool(ctx, "my_appointments", "{}"))["appointments"]
    assert len(upcoming) == 1  # the hospital-pending one is hidden
    hours = json.loads(run_tool(ctx, "my_working_hours", "{}"))
    assert hours["weekly_hours"] == [{"day": "Monday", "from": "09:00 AM", "to": "01:00 PM"}] and hours["fee_rupees"] == 500


def test_patient_requests_and_payments(people):
    p = people
    AppointmentRequest.objects.create(patient=p["patient"], hospital=p["hospital"], preferred_date=timezone.localdate(),
                                      status="declined", admin_note="No neurologist that week")
    PaymentSlip.objects.create(hospital=p["hospital"], patient=p["patient"], number="AH-2026-0001",
                               issued_on=timezone.localdate(), total=Decimal("900"), status="completed",
                               method="upi", paid_on=timezone.localdate())
    PaymentSlip.objects.create(hospital=p["hospital"], patient=p["patient"], number="AH-2026-0002",
                               issued_on=timezone.localdate(), total=Decimal("250"))
    other = User.objects.create_user("other@x.com", "pw", role="patient")
    PaymentSlip.objects.create(hospital=p["hospital"], patient=other, number="AH-2026-0003",
                               issued_on=timezone.localdate(), total=Decimal("5000"))

    ctx = ToolContext(p["patient"])
    req = json.loads(run_tool(ctx, "my_requests", "{}"))["requests"]
    assert req[0]["admin_note"] == "No neurologist that week"
    pay = json.loads(run_tool(ctx, "my_payments", "{}"))
    assert (pay["pending_total_rupees"], pay["paid_total_rupees"], len(pay["slips"])) == (250, 900, 2)  # only their own


class CapturingOpenAI:
    """Like the fake in tests.py, but keeps the whole request (to see which tools were offered)."""

    def __init__(self, *responses):
        self.responses, self.calls = list(responses), []
        from types import SimpleNamespace

        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        return self.responses.pop(0)


def test_the_api_offers_only_the_roles_tools(people, monkeypatch, settings):
    settings.OPENAI_API_KEY = "test-key"
    fake = CapturingOpenAI(answer(calls=[tool_call("my_schedule", {})]), answer("You have 0 patients today."),
                           answer("Use Doctor management, then Add."))
    monkeypatch.setattr(service, "get_client", lambda: fake)

    c = APIClient()
    c.force_authenticate(people["doctor_user"])
    assert c.post("/api/chat/", {"message": "How many patients today?"}, format="json").data["reply"] == "You have 0 patients today."
    offered = {t["function"]["name"] for t in fake.calls[0]["tools"]}
    assert offered == names(roles.DOCTOR)

    c.force_authenticate(people["hospital_user"])
    res = c.post("/api/chat/", {"message": "How do I add a doctor?"}, format="json")
    assert res.status_code == 200 and "tools" not in fake.calls[2]  # no data tools for hospitals yet
