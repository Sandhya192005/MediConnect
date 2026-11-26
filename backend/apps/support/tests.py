"""Contact support (Part 1)."""

import pytest
from django.contrib.admin.sites import site
from django.contrib.auth import get_user_model
from django.core import mail
from django.test import RequestFactory
from rest_framework.test import APIClient

from apps.notifications.models import Notification
from apps.support.models import SupportRequest

User = get_user_model()


def client_for(user=None):
    c = APIClient()
    if user:
        c.force_authenticate(user)
    return c


def send(c, **data):
    body = {"topic": "appointment", "subject": "Can't cancel", "message": "The cancel button does nothing for me.", **data}
    return c.post("/api/support/", body, format="json")


@pytest.mark.django_db
def test_any_user_sends_a_support_request_and_the_inbox_is_emailed(settings, django_capture_on_commit_callbacks):
    settings.SUPPORT_EMAIL = "help@example.com"
    for role in ("patient", "doctor", "admin"):
        user = User.objects.create_user(f"{role}@example.com", "pw", role=role)
        with django_capture_on_commit_callbacks(execute=True):
            r = send(client_for(user))
        assert r.status_code == 201
        assert r.json()["status"] == "open" and r.json()["topic_label"] == "Appointments"
    assert [m.to for m in mail.outbox] == [["help@example.com"]] * 3
    assert "The cancel button does nothing" in mail.outbox[0].body


@pytest.mark.django_db
def test_users_only_see_their_own_requests():
    a = User.objects.create_user("a@example.com", "pw")
    b = User.objects.create_user("b@example.com", "pw")
    rid = send(client_for(a)).json()["id"]
    assert client_for(b).get("/api/support/").json() == []
    assert client_for(b).get(f"/api/support/{rid}/").status_code == 404
    assert client_for().get("/api/support/").status_code == 401


@pytest.mark.django_db
def test_validation_and_users_cannot_set_status_or_reply():
    c = client_for(User.objects.create_user("a@example.com", "pw"))
    assert "at least 10" in str(send(c, message="help").json())
    assert send(c, subject="  ").status_code == 400
    r = send(c, status="closed", reply="all fixed")
    assert (r.json()["status"], r.json()["reply"]) == ("open", "")


@pytest.mark.django_db
def test_a_reply_in_django_admin_closes_it_and_notifies_the_user():
    user = User.objects.create_user("a@example.com", "pw")
    req_id = send(client_for(user)).json()["id"]
    boss = User.objects.create_superuser("boss@example.com", "pw")
    admin = site._registry[SupportRequest]
    obj = SupportRequest.objects.get(pk=req_id)
    obj.reply = "Fixed now, please try again."

    class Form:
        changed_data = ["reply"]

    request = RequestFactory().post("/")
    request.user = boss
    admin.save_model(request, obj, Form(), change=True)
    obj.refresh_from_db()
    assert obj.status == "closed"
    note = Notification.objects.get(user=user, kind="support_reply")
    assert "Fixed now" in note.message and note.link == "/support"
    assert client_for(user).get("/api/support/").json()[0]["reply"] == "Fixed now, please try again."


@pytest.mark.django_db
def test_sending_is_rate_limited(monkeypatch):
    from rest_framework.throttling import ScopedRateThrottle

    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", {"support": "2/hour"})
    c = client_for(User.objects.create_user("a@example.com", "pw"))
    assert [send(c).status_code for _ in range(3)] == [201, 201, 429]
    assert c.get("/api/support/").status_code == 200  # reading isn't limited


# ---- Support inbox in the app (owner request 2026-11-20) ------------------------------------------------------

INBOX = "/api/support/inbox/"


@pytest.fixture
def inbox_world(db):
    doctor = User.objects.create_user("dr@example.com", "pw", role="doctor", first_name="Jeeva", last_name="D")
    patient = User.objects.create_user("pt@example.com", "pw", role="patient")
    boss = User.objects.create_superuser("boss@example.com", "pw", role="admin")
    return {"doctor": doctor, "patient": patient, "boss": boss}


def test_a_new_message_notifies_the_platform_admin(inbox_world, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        assert send(client_for(inbox_world["doctor"]), subject="Slots not showing").status_code == 201
    n = Notification.objects.get(user=inbox_world["boss"])
    assert n.kind == "support_request" and n.link == "/admin/support"
    assert "Jeeva D (doctor): Slots not showing" == n.message
    assert not Notification.objects.filter(user=inbox_world["doctor"]).exists()


def test_inbox_lists_everyone_with_sender_and_filters_by_status(inbox_world):
    send(client_for(inbox_world["doctor"]), subject="From the doctor")
    send(client_for(inbox_world["patient"]), subject="From the patient")
    rows = client_for(inbox_world["boss"]).get(INBOX, {"status": "open"}).json()
    assert {r["subject"] for r in rows} == {"From the doctor", "From the patient"}
    doc = next(r for r in rows if r["subject"] == "From the doctor")
    assert (doc["sender_name"], doc["sender_email"], doc["sender_role"]) == ("Jeeva D", "dr@example.com", "doctor")
    assert client_for(inbox_world["boss"]).get(INBOX, {"status": "closed"}).json() == []


def test_reply_notifies_the_sender_and_they_see_it(inbox_world, django_capture_on_commit_callbacks):
    send(client_for(inbox_world["doctor"]))
    req = SupportRequest.objects.get()
    boss = client_for(inbox_world["boss"])
    assert boss.post(f"{INBOX}{req.id}/reply/", {"reply": "  "}, format="json").status_code == 400
    with django_capture_on_commit_callbacks(execute=True):
        r = boss.post(f"{INBOX}{req.id}/reply/", {"reply": "Fixed it, try again."}, format="json")
    assert r.status_code == 200 and r.json()["status"] == "closed"  # replying closes it (2026-11-25)
    n = Notification.objects.get(user=inbox_world["doctor"], kind="support_reply")
    assert "Fixed it" in n.message
    mine = client_for(inbox_world["doctor"]).get("/api/support/").json()
    assert mine[0]["reply"] == "Fixed it, try again." and mine[0]["status"] == "closed"
    # Reopen, and an edited reply closes it again.
    assert boss.post(f"{INBOX}{req.id}/status/", {"status": "open"}, format="json").json()["status"] == "open"
    assert boss.post(f"{INBOX}{req.id}/reply/", {"reply": "Done."}, format="json").json()["status"] == "closed"
    assert boss.post(f"{INBOX}{req.id}/status/", {"status": "open"}, format="json").json()["status"] == "open"
    assert boss.post(f"{INBOX}{req.id}/status/", {"status": "lost"}, format="json").status_code == 400
    assert boss.post(f"{INBOX}{req.id}/status/", {"status": "answered"}, format="json").status_code == 400  # removed


def test_only_the_platform_admin_uses_the_inbox(inbox_world):
    send(client_for(inbox_world["patient"]))
    req = SupportRequest.objects.get()
    hospital = User.objects.create_user("h@example.com", "pw", role="hospital")
    for user in (inbox_world["doctor"], inbox_world["patient"], hospital):
        assert client_for(user).get(INBOX).status_code == 403
        assert client_for(user).post(f"{INBOX}{req.id}/reply/", {"reply": "x"}, format="json").status_code == 403
    assert client_for().get(INBOX).status_code == 401
    # Users still only see their own messages.
    assert client_for(inbox_world["doctor"]).get("/api/support/").json() == []
