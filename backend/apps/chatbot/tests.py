"""Chatbot tests use a scripted fake OpenAI client: no API key, no cost, predictable replies."""

import json
from datetime import time, timedelta
from types import SimpleNamespace

import openai
import pytest
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.utils import timezone
from rest_framework.test import APIClient

from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile, WeeklyAvailability
from apps.hospitals.models import Hospital

from . import service
from .models import ChatMessage

User = get_user_model()


# ---- fake OpenAI -------------------------------------------------------------

def tool_call(name, args, call_id="call_1"):
    return SimpleNamespace(id=call_id, type="function", function=SimpleNamespace(name=name, arguments=json.dumps(args)))


def answer(content=None, calls=None):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=calls))])


class FakeOpenAI:
    """Returns the scripted responses in order and records every request."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.requests.append(json.loads(json.dumps(kwargs["messages"], default=str)))
        return self.responses.pop(0)


@pytest.fixture
def use_fake(monkeypatch, settings):
    settings.OPENAI_API_KEY = "test-key"

    def install(*responses):
        fake = FakeOpenAI(*responses)
        monkeypatch.setattr(service, "get_client", lambda: fake)
        return fake

    return install


# ---- data -------------------------------------------------------------------

@pytest.fixture
def doctor(db):
    user = User.objects.create_user("anita@x.com", "pw", role="doctor", first_name="Anita", last_name="Rao")
    d = DoctorProfile.objects.get(user=user)
    d.hospital = Hospital.objects.create(name="City Hospital", city="Chennai", location=Point(80.25, 13.06))
    d.specialization = "Cardiologist"
    d.save()
    for wd in range(7):
        WeeklyAvailability.objects.create(doctor=d, weekday=wd, start_time=time(9), end_time=time(12))
    return d


@pytest.fixture
def patient(db):
    return User.objects.create_user("pat@x.com", "pw", first_name="Pat")


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


def tomorrow():
    return (timezone.localdate() + timedelta(days=1)).isoformat()


# ---- tests ------------------------------------------------------------------

def test_tool_loop_searches_and_answers(use_fake, doctor, patient):
    fake = use_fake(
        answer(calls=[tool_call("search_doctors", {"query": "Cardiologist", "city": "Chennai"})]),
        answer("Dr. Anita Rao is a cardiologist at City Hospital."),
    )
    res = client_for(patient).post("/api/chat/", {"message": "I need a heart doctor in Chennai"}, format="json")
    assert res.status_code == 200
    assert res.data["reply"] == "Dr. Anita Rao is a cardiologist at City Hospital."

    # The second request to OpenAI carried our tool result with real data.
    tool_msg = [m for m in fake.requests[1] if m["role"] == "tool"][0]
    assert "Anita" in tool_msg["content"]
    assert ChatMessage.objects.filter(session_id=res.data["session_id"]).count() == 4  # user, call, tool, answer


def test_propose_booking_shows_card_but_does_not_book(use_fake, doctor, patient):
    from .tools import ToolContext, get_available_slots

    start = get_available_slots(ToolContext(patient), doctor.id, tomorrow())["free_slots"][0]["start"]
    use_fake(
        answer(calls=[tool_call("propose_booking", {"doctor_id": doctor.id, "start": start, "reason": "Checkup"})]),
        answer("Here's your booking — press Confirm to book it."),
    )
    res = client_for(patient).post("/api/chat/", {"message": "Book the first slot tomorrow"}, format="json")
    assert res.status_code == 200
    [card] = res.data["proposals"]
    assert card["doctor_id"] == doctor.id and card["reason"] == "Checkup"
    assert Appointment.objects.count() == 0  # nothing booked until the user confirms

    # The card's start works with the normal booking API (what the Confirm button calls).
    booked = client_for(patient).post("/api/appointments/", {"doctor": doctor.id, "start": card["start"]}, format="json")
    assert booked.status_code == 201


def test_propose_booking_rejects_taken_or_bad_slots(doctor, patient):
    from .tools import ToolContext, get_available_slots, propose_booking

    ctx = ToolContext(patient)
    start = get_available_slots(ctx, doctor.id, tomorrow())["free_slots"][0]["start"]
    Appointment.objects.create(doctor=doctor, patient=patient, start=start, end=start)  # someone took it
    assert "error" in propose_booking(ctx, doctor.id, start)
    assert "error" in propose_booking(ctx, doctor.id, "not-a-date")
    assert "error" in propose_booking(ToolContext(doctor.user), doctor.id, start)  # doctors can't book
    assert ctx.proposals == []


def test_slots_tool_validates_dates(doctor, patient):
    from .tools import ToolContext, get_available_slots

    ctx = ToolContext(patient)
    assert "error" in get_available_slots(ctx, doctor.id, "2020-01-01")
    assert "error" in get_available_slots(ctx, doctor.id, "tomorrow")
    assert "error" in get_available_slots(ctx, 99999, tomorrow())
    assert get_available_slots(ctx, doctor.id, tomorrow())["total_free"] == 12  # 09:00–12:00, 15 min


def test_find_hospitals_uses_shared_location_or_city(doctor, patient):
    from .tools import ToolContext, find_hospitals

    near = find_hospitals(ToolContext(patient, {"lat": 13.08, "lng": 80.27}))
    assert near["hospitals"][0]["name"] == "City Hospital"
    assert find_hospitals(ToolContext(patient), city="chennai")["hospitals"][0]["name"] == "City Hospital"
    assert "error" in find_hospitals(ToolContext(patient))  # no location and no city


def test_unknown_tool_and_bad_arguments_are_safe(patient):
    from .tools import ToolContext, run_tool

    ctx = ToolContext(patient)
    assert "error" in json.loads(run_tool(ctx, "drop_database", "{}"))
    assert "error" in json.loads(run_tool(ctx, "search_doctors", "not json"))
    assert "error" in json.loads(run_tool(ctx, "search_doctors", '{"bogus": 1}'))


def test_conversation_continues_in_same_session(use_fake, patient):
    fake = use_fake(answer("Hi Pat!"), answer("You said hello earlier."))
    c = client_for(patient)
    sid = c.post("/api/chat/", {"message": "hello"}, format="json").data["session_id"]
    c.post("/api/chat/", {"message": "what did I say?", "session_id": sid}, format="json")
    contents = [m["content"] for m in fake.requests[1]]
    assert "hello" in contents and "Hi Pat!" in contents

    hist = c.get("/api/chat/history/").data
    assert hist["session_id"] == sid
    assert [m["role"] for m in hist["messages"]] == ["user", "assistant", "user", "assistant"]


def test_cannot_use_someone_elses_session(use_fake, patient):
    use_fake(answer("hi"))
    sid = client_for(patient).post("/api/chat/", {"message": "hi"}, format="json").data["session_id"]
    other = User.objects.create_user("other@x.com", "pw")
    assert client_for(other).post("/api/chat/", {"message": "hi", "session_id": sid}, format="json").status_code == 404
    assert client_for(other).get(f"/api/chat/history/?session_id={sid}").status_code == 404


def test_emergency_banner(use_fake, patient):
    use_fake(answer("Please call 112 now."))
    res = client_for(patient).post("/api/chat/", {"message": "my father has chest pain and can't breathe"}, format="json")
    assert res.data["emergency"] is True
    assert "112" in res.data["emergency_notice"]


def test_requires_login_and_valid_input(db):
    assert APIClient().post("/api/chat/", {"message": "hi"}, format="json").status_code == 401
    u = User.objects.create_user("u@x.com", "pw")
    assert client_for(u).post("/api/chat/", {"message": ""}, format="json").status_code == 400
    assert client_for(u).post("/api/chat/", {"message": "x" * 1001}, format="json").status_code == 400


def test_missing_or_invalid_key_returns_503(settings, patient, monkeypatch):
    settings.OPENAI_API_KEY = ""
    res = client_for(patient).post("/api/chat/", {"message": "hi"}, format="json")
    assert res.status_code == 503 and "missing" in res.data["detail"]

    def bad_key():
        raise openai.AuthenticationError("bad key", response=SimpleNamespace(status_code=401, request=None, headers={}), body=None)

    monkeypatch.setattr(service, "chat", lambda *a, **k: bad_key())
    res = client_for(patient).post("/api/chat/", {"message": "hi"}, format="json")
    assert res.status_code == 503 and "invalid" in res.data["detail"]


def test_rate_limit(use_fake, patient, settings):
    settings.CHAT_RATE_LIMIT = 2
    use_fake(answer("1"), answer("2"), answer("3"))
    c = client_for(patient)
    assert c.post("/api/chat/", {"message": "a"}, format="json").status_code == 200
    assert c.post("/api/chat/", {"message": "b"}, format="json").status_code == 200
    assert c.post("/api/chat/", {"message": "c"}, format="json").status_code == 429
