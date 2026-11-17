"""Profile & settings (Part 1): patient details, change password, forgot password."""

import re
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

User = get_user_model()
STRONG = "Blue-Tiger-42!"


def client_for(user=None):
    c = APIClient()
    if user:
        c.force_authenticate(user)
    return c


@pytest.fixture
def patient():
    return User.objects.create_user("asha@example.com", "Old-pass-123", first_name="Asha")


# ---- Profile ----

@pytest.mark.django_db
def test_users_edit_their_name_and_phone_but_not_email_or_role(patient):
    r = client_for(patient).patch("/api/auth/me/", {"first_name": "Asha K", "phone": "9876543210",
                                                     "email": "new@example.com", "role": "admin"}, format="json")
    assert r.status_code == 200
    patient.refresh_from_db()
    assert (patient.first_name, patient.phone) == ("Asha K", "9876543210")
    assert patient.role == "patient"  # role is read-only


@pytest.mark.django_db
def test_patients_save_date_of_birth_and_gender_and_see_their_age(patient):
    c = client_for(patient)
    dob = (timezone.localdate() - timedelta(days=365 * 30 + 10)).isoformat()
    r = c.patch("/api/auth/me/patient/", {"date_of_birth": dob, "gender": "female"}, format="json")
    assert r.status_code == 200 and r.json()["age"] == 30 and r.json()["gender"] == "female"
    assert r.json()["patient_id"].startswith("P")
    future = (timezone.localdate() + timedelta(days=1)).isoformat()
    assert "future" in str(c.patch("/api/auth/me/patient/", {"date_of_birth": future}, format="json").json())
    assert c.patch("/api/auth/me/patient/", {"gender": "unicorn"}, format="json").status_code == 400


@pytest.mark.django_db
def test_only_patients_have_patient_details():
    doc = User.objects.create_user("doc@example.com", "pw", role="doctor")
    assert client_for(doc).get("/api/auth/me/patient/").status_code == 403


# ---- Change password ----

@pytest.mark.django_db
def test_change_password(patient):
    c = client_for(patient)
    wrong = c.post("/api/auth/change-password/", {"current_password": "nope", "new_password": STRONG}, format="json")
    assert wrong.status_code == 400 and "current password" in str(wrong.json())
    weak = c.post("/api/auth/change-password/", {"current_password": "Old-pass-123", "new_password": "123"}, format="json")
    assert weak.status_code == 400
    ok = c.post("/api/auth/change-password/", {"current_password": "Old-pass-123", "new_password": STRONG}, format="json")
    assert ok.status_code == 200
    patient.refresh_from_db()
    assert patient.check_password(STRONG)


# ---- Forgot password ----

def _reset_link():
    assert len(mail.outbox) == 1
    body = mail.outbox[0].body
    m = re.search(r"/reset-password\?uid=([\w-]+)&token=([\w-]+)", body)
    assert m, body
    return m.group(1), m.group(2)


@pytest.mark.django_db
def test_forgot_password_emails_a_one_time_link(patient, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        r = client_for().post("/api/auth/password-reset/", {"email": "ASHA@example.com"}, format="json")
    assert r.status_code == 200
    assert mail.outbox[0].to == ["asha@example.com"]
    uid, token = _reset_link()

    c = client_for()
    weak = c.post("/api/auth/password-reset/confirm/", {"uid": uid, "token": token, "new_password": "123"}, format="json")
    assert weak.status_code == 400 and "new_password" in weak.json()
    ok = c.post("/api/auth/password-reset/confirm/", {"uid": uid, "token": token, "new_password": STRONG}, format="json")
    assert ok.status_code == 200
    patient.refresh_from_db()
    assert patient.check_password(STRONG)
    # The same link can't be used twice (the token depends on the old password).
    again = c.post("/api/auth/password-reset/confirm/", {"uid": uid, "token": token, "new_password": "Another-pass-9"}, format="json")
    assert again.status_code == 400 and "invalid or has expired" in again.json()["detail"]


@pytest.mark.django_db
def test_unknown_emails_get_the_same_answer_and_no_email(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        r = client_for().post("/api/auth/password-reset/", {"email": "nobody@example.com"}, format="json")
    assert r.status_code == 200 and "If an account exists" in r.json()["detail"]
    assert mail.outbox == []


@pytest.mark.django_db
def test_a_made_up_token_is_refused(patient):
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode

    uid = urlsafe_base64_encode(force_bytes(patient.pk))
    r = client_for().post("/api/auth/password-reset/confirm/", {"uid": uid, "token": "made-up", "new_password": STRONG}, format="json")
    assert r.status_code == 400
    assert client_for().post("/api/auth/password-reset/confirm/", {"uid": "%%%", "token": "x", "new_password": STRONG},
                             format="json").status_code == 400


@pytest.mark.django_db
def test_reset_requests_are_rate_limited(monkeypatch):
    from rest_framework.throttling import ScopedRateThrottle

    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", {"password_reset": "2/hour"})
    codes = [client_for().post("/api/auth/password-reset/", {"email": "x@example.com"}, format="json").status_code
             for _ in range(3)]
    assert codes == [200, 200, 429]
