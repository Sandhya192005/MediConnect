"""
Hospital sign-up (owner request 2026-11-18): a hospital manages its staff and records on MediConnect.
Since 2026-11-19 the hospital itself is the account: role "hospital", logging in with the hospital's email.
"""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.hospitals.models import Hospital
from apps.staff.models import HospitalAdmin

User = get_user_model()
STRONG = "Blue-Tiger-42!"
URL = "/api/auth/register-hospital/"


def signup(**overrides):
    body = {"email": "manager@sunrise.example", "password": STRONG, "hospital_name": "  Sunrise   Clinic ", "hospital_city": "chennai", "hospital_phone": "044 1234"}
    return APIClient().post(URL, {**body, **overrides}, format="json")


def login(email, password=STRONG):
    c = APIClient()
    token = c.post("/api/auth/login/", {"email": email, "password": password}, format="json").json()["access"]
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return c


@pytest.mark.django_db
def test_a_hospital_signs_up_and_gets_a_private_workspace():
    r = signup()
    assert r.status_code == 201, r.json()
    assert r.json() == {"id": r.json()["id"], "email": "manager@sunrise.example", "role": "hospital"}

    user = User.objects.get(email="manager@sunrise.example")
    hospital = HospitalAdmin.objects.get(user=user).hospital
    assert (user.role, user.is_superuser, user.is_staff) == ("hospital", False, False)  # never a platform admin
    assert (user.first_name, user.last_name, user.phone) == ("Sunrise Clinic", "", "044 1234")  # named after the hospital
    assert (hospital.name, hospital.city, hospital.phone, hospital.email) == ("Sunrise Clinic", "Chennai", "044 1234",
                                                                              "manager@sunrise.example")
    assert (hospital.source, hospital.is_approved, hospital.approved_at) == ("account", False, None)
    assert hospital.location is None and not hospital.location_verified  # no invented pin

    c = login("manager@sunrise.example")
    me = c.get("/api/auth/me/").json()
    assert me["admin_hospital"]["id"] == hospital.id and not me["is_platform_admin"]
    overview = c.get("/api/hospital-admin/overview/").json()
    assert overview["hospital"] == {"id": hospital.id, "name": "Sunrise Clinic", "city": "Chennai", "connected": False}

    # The workspace works straight away: add a nurse.
    r = c.post("/api/hospital-admin/staff/", {"kind": "nurse", "full_name": "Meena", "join_date": "2026-01-05",
                                              "monthly_salary": "28000"}, format="json")
    assert r.status_code == 201, r.json()


@pytest.mark.django_db
def test_a_signed_up_hospital_is_invisible_to_patients_until_connected():
    signup()
    hospital = Hospital.objects.get(name="Sunrise Clinic")
    assert not hospital.is_listed and not hospital.is_partner
    anyone = APIClient()
    assert hospital.id not in [h["id"] for h in anyone.get("/api/hospitals/").json()]
    assert anyone.get(f"/api/hospitals/{hospital.id}/").status_code == 404

    hospital.is_approved = True  # the platform admin connects it
    hospital.save()
    assert hospital.id in [h["id"] for h in anyone.get("/api/hospitals/").json()]


@pytest.mark.django_db
def test_signed_up_hospitals_count_as_hospital_accounts_not_connected_hospitals():
    signup()
    boss = User.objects.create_superuser("owner@example.com", "pw")
    c = APIClient()
    c.force_authenticate(boss)
    o = c.get("/api/platform/overview/").json()
    assert o["hospital_accounts"]["total"] == 1
    assert o["hospitals"]["total"] == 0


@pytest.mark.django_db
def test_signed_up_hospitals_can_open_records_by_patient_id():
    """Owner decision 2026-11-18 ("B. No check"): like self-registered doctors, no verification first."""
    signup()
    patient = User.objects.create_user("asha@example.com", "pw")
    code = patient.patient_profile.patient_id
    r = login("manager@sunrise.example").get(f"/api/records/patients/{code}/")
    assert r.status_code == 200 and r.json()["patient"]["patient_id"] == code


@pytest.mark.django_db
@pytest.mark.parametrize("overrides, field", [
    ({"password": "12345678"}, "password"),
    ({"email": "not-an-email"}, "email"),
    ({"hospital_name": "AB"}, "hospital_name"),
    ({"hospital_name": ""}, "hospital_name"),
    ({"hospital_city": ""}, "hospital_city"),
    ({"email": ""}, "email"),
])
def test_bad_hospital_sign_ups_are_refused(overrides, field):
    r = signup(**overrides)
    assert r.status_code == 400 and field in r.json()
    assert not Hospital.objects.filter(source="account").exists()  # nothing half-created


@pytest.mark.django_db
def test_an_email_can_only_sign_up_once_and_extra_fields_are_ignored():
    User.objects.create_user("Manager@Sunrise.example", "pw")
    assert "email" in signup().json()
    r = signup(email="other@sunrise.example", role="patient", is_superuser=True, is_approved=True)
    assert r.status_code == 201
    user = User.objects.get(email="other@sunrise.example")
    assert user.role == "hospital" and not user.is_superuser
    assert not HospitalAdmin.objects.get(user=user).hospital.is_approved
