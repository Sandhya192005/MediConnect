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
def test_a_reply_in_django_admin_marks_it_answered_and_notifies_the_user():
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
    assert obj.status == "answered"
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
