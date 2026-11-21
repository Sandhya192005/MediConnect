"""Hospital profile (owner request 2026-11-20): a hospital account edits its own hospital, including its map pin."""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.hospitals.models import Department, Hospital
from apps.notifications.models import Notification
from apps.staff.models import HospitalAdmin

User = get_user_model()
URL = "/api/hospital-admin/profile/"


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def setup(db):
    h = Hospital.objects.create(name="City Hospital", city="Chennai", email="info@city.example", is_approved=False,
                                source="account")
    other = Hospital.objects.create(name="Other Hospital", city="Chennai")
    account = User.objects.create_user("info@city.example", "pw", role="hospital", first_name="City Hospital")
    HospitalAdmin.objects.create(user=account, hospital=h)
    platform = User.objects.create_superuser("boss@example.com", "pw", role="admin")
    return {"h": h, "other": other, "account": account, "platform": platform}


def test_get_shows_own_hospital(setup):
    r = client_for(setup["account"]).get(URL)
    assert r.status_code == 200
    assert r.json()["name"] == "City Hospital"
    assert r.json()["email"] == "info@city.example"
    assert r.json()["latitude"] is None and r.json()["connected"] is False


def test_edit_details_departments_and_pin(setup, django_capture_on_commit_callbacks):
    cardio = Department.objects.create(name="Cardiology")
    ortho = Department.objects.create(name="Orthopaedics")
    with django_capture_on_commit_callbacks(execute=True):
        r = client_for(setup["account"]).patch(URL, {
            "name": "  City   Care Hospital ", "address": "12 Anna Salai", "city": "Chennai", "phone": "+91 44 1234 5678",
            "website": "https://citycare.example", "department_ids": [cardio.id, ortho.id],
            "latitude": 13.06, "longitude": 80.25, "email": "hacker@example.com", "location_verified": False,
        }, format="json")
    assert r.status_code == 200, r.json()
    h = Hospital.objects.get(pk=setup["h"].pk)
    assert h.name == "City Care Hospital"  # extra spaces removed
    assert h.website == "https://citycare.example" and h.website_source == ""
    assert {d.name for d in h.departments.all()} == {"Cardiology", "Orthopaedics"}
    assert (round(h.location.y, 2), round(h.location.x, 2)) == (13.06, 80.25)
    assert h.location_verified is True  # the hospital's own pin counts as confirmed
    assert h.email == "info@city.example"  # the login email can't be changed here
    assert User.objects.get(pk=setup["account"].pk).first_name == "City Care Hospital"  # account name follows
    # The platform admin is told about the name change (not about the pin).
    n = Notification.objects.get(user=setup["platform"])
    assert "City Care Hospital" in n.message and "name" in n.message and "city" not in n.message
    # The other hospital is untouched.
    assert Hospital.objects.get(pk=setup["other"].pk).name == "Other Hospital"


def test_moving_pin_only_sends_no_notification_and_removing_clears_it(setup, django_capture_on_commit_callbacks):
    c = client_for(setup["account"])
    with django_capture_on_commit_callbacks(execute=True):
        assert c.patch(URL, {"latitude": 13.0, "longitude": 80.2}, format="json").status_code == 200
    assert not Notification.objects.exists()
    r = c.patch(URL, {"latitude": None, "longitude": None}, format="json")
    assert r.status_code == 200 and r.json()["latitude"] is None and r.json()["location_verified"] is False


@pytest.mark.parametrize("body", [
    {"latitude": 13.0},                               # one without the other
    {"latitude": 95, "longitude": 80},                # out of range
    {"name": " "},
    {"city": ""},
    {"phone": "call me maybe"},
    {"website": "not a url"},
    {"department_ids": [99999]},
])
def test_bad_input_is_rejected(setup, body):
    r = client_for(setup["account"]).patch(URL, body, format="json")
    assert r.status_code == 400
    assert Hospital.objects.get(pk=setup["h"].pk).name == "City Hospital"


def test_connected_hospital_keeps_address_and_phone_and_city_change_notifies(setup, django_capture_on_commit_callbacks):
    h = setup["h"]
    h.is_approved, h.address, h.phone = True, "12 Anna Salai", "044 1234"
    h.save()
    c = client_for(setup["account"])
    assert c.patch(URL, {"address": ""}, format="json").status_code == 400
    assert c.patch(URL, {"phone": ""}, format="json").status_code == 400
    with django_capture_on_commit_callbacks(execute=True):
        r = c.patch(URL, {"city": "Coimbatore"}, format="json")
    assert r.status_code == 200 and r.json()["connected"] is True
    assert "Coimbatore" in Notification.objects.get(user=setup["platform"]).message


def test_only_hospital_accounts(setup):
    patient = User.objects.create_user("p@example.com", "pw")
    assert client_for(patient).get(URL).status_code == 403
    assert client_for(setup["platform"]).patch(URL, {"name": "X"}, format="json").status_code == 403
    assert APIClient().get(URL).status_code == 401
