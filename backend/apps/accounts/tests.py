import pytest
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_register_login_me():
    client = APIClient()
    res = client.post(
        "/api/auth/register/",
        {"email": "p@example.com", "password": "StrongPass!123", "first_name": "Pat"},
        format="json",
    )
    assert res.status_code == 201
    assert res.data["role"] == "patient"

    res = client.post(
        "/api/auth/login/", {"email": "p@example.com", "password": "StrongPass!123"}, format="json"
    )
    assert res.status_code == 200
    assert res.data["user"]["role"] == "patient"

    client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
    res = client.get("/api/auth/me/")
    assert res.status_code == 200
    assert res.data["email"] == "p@example.com"


@pytest.mark.django_db
def test_cannot_register_as_admin():
    res = APIClient().post(
        "/api/auth/register/",
        {"email": "a@example.com", "password": "StrongPass!123", "role": "admin"},
        format="json",
    )
    assert res.status_code == 400
