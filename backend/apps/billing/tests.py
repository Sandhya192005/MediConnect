"""Payment slips (owner decisions 2026-11-21): itemised, pending → completed, locked when paid, the patient sees them."""

from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import PatientProfile
from apps.billing.models import PaymentSlip
from apps.hospitals.models import Hospital
from apps.notifications.models import Notification
from apps.staff.models import HospitalAdmin, HospitalPatient

User = get_user_model()
H = "/api/hospital-admin/payments/"
NOW = timezone.make_aware(datetime(2026, 11, 21, 12, 0))


@pytest.fixture(autouse=True)
def frozen_now(monkeypatch):
    monkeypatch.setattr(timezone, "now", lambda: NOW)


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def world():
    city = Hospital.objects.create(name="City Care Hospital", city="Chennai", is_approved=True, phone="044 2222 3333")
    other = Hospital.objects.create(name="Other Hospital", city="Chennai", is_approved=True)
    desk = User.objects.create_user("desk@city.example", "pw", role="hospital")
    HospitalAdmin.objects.create(user=desk, hospital=city)
    other_desk = User.objects.create_user("desk@other.example", "pw", role="hospital")
    HospitalAdmin.objects.create(user=other_desk, hospital=other)
    asha = User.objects.create_user("asha@example.com", "pw", first_name="Asha", last_name="K", phone="9876543210")
    HospitalPatient.objects.create(hospital=city, patient=asha)
    return {"city": city, "desk": desk, "other_desk": other_desk, "asha": asha,
            "pid": PatientProfile.for_user(asha).patient_id}


ITEMS = [{"description": "Consultation", "quantity": 1, "unit_price": "700"},
         {"description": "Blood test", "quantity": 2, "unit_price": "225.50"}]


def new_slip(world, **extra):
    r = client_for(world["desk"]).post(H, {"patient_id": world["pid"], "items": ITEMS, "discount": "51", **extra}, format="json")
    assert r.status_code == 201, r.json()
    return r.json()


@pytest.mark.django_db
def test_an_itemised_slip_is_numbered_and_totalled_by_the_server(world, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        s = new_slip(world, total="1")  # a total sent by the browser is ignored
    assert s["number"] == "CCH-2026-0001" and s["status"] == "pending" and s["issued_on"] == "2026-11-21"
    assert [(i["description"], i["quantity"], i["amount"]) for i in s["items"]] == [
        ("Consultation", 1, 700), ("Blood test", 2, 451)]
    assert (s["subtotal"], s["discount"], s["total"]) == (1151, 51, 1100)
    assert s["hospital"]["name"] == "City Care Hospital" and s["patient"]["patient_id"] == world["pid"]
    assert Notification.objects.get(user=world["asha"], kind="payment_created").message == \
        "City Care Hospital: CCH-2026-0001, ₹1,100 (pending)."
    assert new_slip(world)["number"] == "CCH-2026-0002"


@pytest.mark.django_db
def test_bad_slips_are_refused(world):
    c = client_for(world["desk"])
    base = {"patient_id": world["pid"]}
    assert "items" in c.post(H, {**base, "items": []}, format="json").json()
    assert "Line 1" in str(c.post(H, {**base, "items": [{"description": "", "unit_price": "5"}]}, format="json").json())
    assert "negative" in str(c.post(H, {**base, "items": [{"description": "X", "unit_price": "-5"}]}, format="json").json())
    assert "more than the bill" in str(c.post(H, {**base, "items": ITEMS, "discount": "5000"}, format="json").json())
    assert "future" in str(c.post(H, {**base, "items": ITEMS, "issued_on": "2026-12-01"}, format="json").json())
    # Only patients in the hospital's list, and real patient IDs.
    stranger = User.objects.create_user("x@example.com", "pw")
    r = c.post(H, {"patient_id": PatientProfile.for_user(stranger).patient_id, "items": ITEMS}, format="json")
    assert r.status_code == 403
    assert c.post(H, {"patient_id": "P000000", "items": ITEMS}, format="json").status_code == 404


@pytest.mark.django_db
def test_pending_is_editable_completed_is_locked_until_reopened_with_a_reason(world, django_capture_on_commit_callbacks):
    c = client_for(world["desk"])
    s = new_slip(world)
    r = c.patch(f"{H}{s['id']}/", {"items": [{"description": "Consultation", "unit_price": "800"}], "discount": "0"}, format="json")
    assert r.json()["total"] == 800 and len(r.json()["items"]) == 1

    assert "how it was paid" in str(c.post(f"{H}{s['id']}/complete/", {}, format="json").json())
    with django_capture_on_commit_callbacks(execute=True):
        r = c.post(f"{H}{s['id']}/complete/", {"method": "upi"}, format="json")
    assert (r.json()["status"], r.json()["method_label"], r.json()["paid_on"]) == ("completed", "UPI", "2026-11-21")
    assert Notification.objects.filter(user=world["asha"], kind="payment_paid").exists()

    # Locked: no edits, no cancel.
    assert "Only a pending slip" in str(c.patch(f"{H}{s['id']}/", {"discount": "10"}, format="json").json())
    assert c.post(f"{H}{s['id']}/cancel/", {}, format="json").status_code == 400
    # Back to pending needs a reason, which stays on the slip.
    assert "reason" in c.post(f"{H}{s['id']}/reopen/", {}, format="json").json()
    r = c.post(f"{H}{s['id']}/reopen/", {"reason": "UPI payment failed"}, format="json")
    assert (r.json()["status"], r.json()["method"], r.json()["reopen_reason"]) == ("pending", "", "UPI payment failed")
    r = c.post(f"{H}{s['id']}/cancel/", {"reason": "Billed twice"}, format="json")
    assert (r.json()["status"], r.json()["cancel_reason"]) == ("cancelled", "Billed twice")


@pytest.mark.django_db
def test_a_slip_can_be_created_already_paid(world):
    s = new_slip(world, status="completed", method="cash", paid_on="2026-11-20")
    assert (s["status"], s["method"], s["paid_on"]) == ("completed", "cash", "2026-11-20")


@pytest.mark.django_db
def test_lists_totals_and_who_sees_what(world):
    a, b = new_slip(world), new_slip(world)
    client_for(world["desk"]).post(f"{H}{b['id']}/complete/", {"method": "card"}, format="json")
    data = client_for(world["desk"]).get(f"{H}?patient={world['pid'].lower()}").json()
    assert data["totals"] == {"pending": 1100, "completed": 1100}
    assert [s["number"] for s in data["slips"]] == ["CCH-2026-0002", "CCH-2026-0001"]
    assert len(client_for(world["desk"]).get(f"{H}?status=pending").json()["slips"]) == 1
    # Patient management's list shows what the patient still owes this hospital.
    row = next(r for r in client_for(world["desk"]).get("/api/hospital-admin/patients/").json() if r["patient_id"] == world["pid"])
    assert row["pending_amount"] == 1100

    # The patient sees their slips (read-only).
    me = client_for(world["asha"])
    mine = me.get("/api/payments/").json()
    assert {s["number"] for s in mine["slips"]} == {"CCH-2026-0001", "CCH-2026-0002"}
    assert me.get(f"/api/payments/{a['id']}/").json()["total"] == 1100
    assert me.post("/api/payments/", {}, format="json").status_code == 405
    assert me.get(H).status_code == 403
    # Another hospital and another patient see nothing.
    assert client_for(world["other_desk"]).get(f"{H}{a['id']}/").status_code == 404
    other_patient = User.objects.create_user("b@example.com", "pw")
    assert client_for(other_patient).get(f"/api/payments/{a['id']}/").status_code == 404


@pytest.mark.django_db
def test_the_database_refuses_a_paid_slip_without_method(world):
    s = PaymentSlip.objects.get(pk=new_slip(world)["id"])
    s.status = "completed"
    with pytest.raises(IntegrityError), transaction.atomic():
        s.save()
