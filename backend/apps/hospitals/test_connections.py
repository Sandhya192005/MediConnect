"""Connecting a signed-up hospital with MediConnect (owner request 2026-11-18)."""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.hospitals.models import ConnectionRequest, Hospital
from apps.notifications.models import Notification
from apps.staff.models import HospitalAdmin

User = get_user_model()
URL = "/api/hospital-admin/connection/"
PLATFORM = "/api/platform/connection-requests/"


def client_for(user=None):
    c = APIClient()
    if user:
        c.force_authenticate(user)
    return c


@pytest.fixture
def world():
    hospital = Hospital.objects.create(name="Sunrise Clinic", city="Chennai", source="account", is_approved=False)
    manager = User.objects.create_user("manager@sunrise.example", "pw", role="admin")
    HospitalAdmin.objects.create(user=manager, hospital=hospital)
    boss = User.objects.create_superuser("owner@example.com", "pw")
    return {"hospital": hospital, "manager": manager, "boss": boss}


def ask(c, **overrides):
    return c.post(URL, {"address": "12 Lake Road, Anna Nagar", "phone": "044 1234 5678",
                        "message": "We have 3 doctors", **overrides}, format="json")


@pytest.mark.django_db
def test_a_hospital_asks_to_connect_and_the_platform_admin_approves(world, django_capture_on_commit_callbacks):
    c = client_for(world["manager"])
    assert c.get(URL).json()["connected"] is False and c.get(URL).json()["request"] is None

    with django_capture_on_commit_callbacks(execute=True):
        r = ask(c)
    assert r.status_code == 201, r.json()
    assert (r.json()["status"], r.json()["message"]) == ("pending", "We have 3 doctors")
    world["hospital"].refresh_from_db()
    assert (world["hospital"].address, world["hospital"].phone) == ("12 Lake Road, Anna Nagar", "044 1234 5678")
    assert Notification.objects.filter(user=world["boss"], kind="connection_requested").exists()

    # Asking twice while waiting is refused (one pending request per hospital).
    assert "already waiting" in str(ask(c).json())

    boss = client_for(world["boss"])
    pending = boss.get(f"{PLATFORM}?status=pending").json()
    assert [p["hospital_name"] for p in pending] == ["Sunrise Clinic"]
    with django_capture_on_commit_callbacks(execute=True):
        r = boss.post(f"{PLATFORM}{pending[0]['id']}/approve/", {}, format="json")
    assert r.status_code == 200 and r.json()["status"] == "approved"

    world["hospital"].refresh_from_db()
    assert world["hospital"].is_approved and world["hospital"].approved_at is not None
    assert Notification.objects.filter(user=world["manager"], kind="connection_approved").exists()
    assert c.get(URL).json()["connected"] is True
    assert "already connected" in str(ask(c).json())
    # Now patients see it.
    assert world["hospital"].id in [h["id"] for h in APIClient().get("/api/hospitals/").json()]


@pytest.mark.django_db
def test_a_decline_needs_a_reason_and_the_hospital_can_ask_again(world, django_capture_on_commit_callbacks):
    c, boss = client_for(world["manager"]), client_for(world["boss"])
    req_id = ask(c).json()["id"]
    assert "note" in boss.post(f"{PLATFORM}{req_id}/decline/", {}, format="json").json()

    with django_capture_on_commit_callbacks(execute=True):
        r = boss.post(f"{PLATFORM}{req_id}/decline/", {"note": "Please add a hospital phone we can verify."}, format="json")
    assert r.json()["status"] == "declined"
    note = Notification.objects.get(user=world["manager"], kind="connection_declined")
    assert "phone we can verify" in note.message
    world["hospital"].refresh_from_db()
    assert not world["hospital"].is_approved

    latest = c.get(URL).json()["request"]
    assert (latest["status"], latest["admin_note"]) == ("declined", "Please add a hospital phone we can verify.")
    assert ask(c).status_code == 201  # asking again is allowed after a decline
    assert "already declined" in str(boss.post(f"{PLATFORM}{req_id}/approve/", {}, format="json").json())


@pytest.mark.django_db
@pytest.mark.parametrize("overrides, field", [({"address": ""}, "address"), ({"phone": ""}, "phone")])
def test_a_request_needs_an_address_and_phone(world, overrides, field):
    r = ask(client_for(world["manager"]), **overrides)
    assert r.status_code == 400 and field in r.json()
    assert not ConnectionRequest.objects.exists()


@pytest.mark.django_db
def test_only_the_right_people_use_each_side(world):
    other_admin = User.objects.create_user("other@example.com", "pw", role="admin")
    HospitalAdmin.objects.create(user=other_admin, hospital=Hospital.objects.create(name="Other", city="Chennai"))
    req_id = ask(client_for(world["manager"])).json()["id"]
    patient = User.objects.create_user("asha@example.com", "pw")

    # Hospital admins and patients can't approve; patients can't ask.
    for user in (world["manager"], other_admin, patient):
        assert client_for(user).post(f"{PLATFORM}{req_id}/approve/", {}, format="json").status_code == 403
        assert client_for(user).get(PLATFORM).status_code == 403
    assert client_for(patient).post(URL, {}, format="json").status_code == 403
    # Another hospital's admin only sees their own hospital.
    assert client_for(other_admin).get(URL).json()["request"] is None
