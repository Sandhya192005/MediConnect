"""Patient management for hospitals (owner request 2026-11-21): add, open, edit, upload and delete records."""

from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import NO_EMAIL_DOMAIN, PatientProfile
from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile
from apps.hospitals.models import Hospital
from apps.notifications.models import Notification
from apps.records.models import MedicalRecord, RecordAccess
from apps.staff.models import HospitalAdmin, HospitalPatient

User = get_user_model()
PDF = b"%PDF-1.4\n% test\n"
BASE = "/api/hospital-admin/patients/"


@pytest.fixture(autouse=True)
def private_media(settings, tmp_path):
    settings.PRIVATE_MEDIA_ROOT = str(tmp_path)


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def world():
    city = Hospital.objects.create(name="City Hospital", city="Chennai", is_approved=True)
    other = Hospital.objects.create(name="Other Hospital", city="Chennai", is_approved=True)
    desk = User.objects.create_user("desk@city.example", "pw", role="hospital")
    HospitalAdmin.objects.create(user=desk, hospital=city)
    other_desk = User.objects.create_user("desk@other.example", "pw", role="hospital")
    HospitalAdmin.objects.create(user=other_desk, hospital=other)
    asha = User.objects.create_user("asha@example.com", "pw", first_name="Asha", last_name="K")
    return {"city": city, "desk": desk, "other_desk": other_desk, "asha": asha,
            "asha_id": PatientProfile.for_user(asha).patient_id}


def upload(client, pid, title="Blood test"):
    return client.post(f"{BASE}{pid}/records/", {
        "title": title, "record_type": "lab_report",
        "file": SimpleUploadedFile("blood.pdf", PDF, content_type="application/pdf"),
    }, format="multipart")


@pytest.mark.django_db
def test_add_a_new_patient_without_email_or_password(world):
    c = client_for(world["desk"])
    r = c.post(f"{BASE}add/", {"first_name": "Ravi", "last_name": "S", "phone": "98765 43210",
                               "date_of_birth": "1980-02-01", "gender": "male"}, format="json")
    assert r.status_code == 201, r.json()
    pid = r.json()["patient_id"]
    user = PatientProfile.objects.get(patient_id=pid).user
    assert user.role == "patient" and user.email.endswith("@" + NO_EMAIL_DOMAIN) and not user.has_real_email
    assert not user.has_usable_password()  # no password: hospitals and doctors open records by ID
    assert len(mail.outbox) == 0  # nothing is sent

    rows = {p["patient_id"]: p for p in c.get(BASE).json()}
    assert rows[pid]["email"] is None and rows[pid]["created_by_you"] and rows[pid]["phone"] == "98765 43210"
    page = c.get(f"{BASE}{pid}/").json()
    assert page["patient"]["name"] == "Ravi S" and page["patient"]["has_login"] is False
    assert page["details"]["gender"] == "male" and page["details"]["date_of_birth"] == "1980-02-01"

    # Name and phone are required; a used email is refused without saying whose it is.
    assert "first_name" in c.post(f"{BASE}add/", {"phone": "9876543210"}, format="json").json()
    r = c.post(f"{BASE}add/", {"first_name": "X", "phone": "9876543210", "email": "asha@example.com"}, format="json")
    assert r.status_code == 400 and "patient ID" in str(r.json())

    # Later the hospital adds the patient's email: they can then claim the account with "Forgot password?".
    r = c.patch(f"{BASE}{pid}/", {"email": "ravi@example.com"}, format="json")
    assert r.json()["patient"]["email"] == "ravi@example.com" and r.json()["patient"]["can_edit_email"]
    # A typo can be fixed while the patient hasn't started using the app (owner request 2026-11-22)…
    r = c.patch(f"{BASE}{pid}/", {"email": "ravi.s@example.com"}, format="json")
    assert r.json()["patient"]["email"] == "ravi.s@example.com"
    # …but once they log in themselves, the email is theirs.
    user.refresh_from_db()
    user.set_password("their-own-pass-1")
    user.save()
    assert c.get(f"{BASE}{pid}/").json()["patient"]["can_edit_email"] is False
    assert "own email" in str(c.patch(f"{BASE}{pid}/", {"email": "x@example.com"}, format="json").json())
    assert c.patch(f"{BASE}{pid}/", {"email": "ravi.s@example.com", "phone": "9000000002"}, format="json").status_code == 200  # same email: fine


@pytest.mark.django_db
def test_add_an_existing_patient_by_id(world):
    c = client_for(world["desk"])
    assert world["asha_id"] not in [p["patient_id"] for p in c.get(BASE).json()]
    r = c.post(f"{BASE}add/", {"patient_id": world["asha_id"].lower()}, format="json")
    assert r.status_code == 201 and r.json() == {"patient_id": world["asha_id"], "already": False}
    assert c.post(f"{BASE}add/", {"patient_id": world["asha_id"]}, format="json").json()["already"] is True
    assert c.post(f"{BASE}add/", {"patient_id": "P000000"}, format="json").status_code == 404
    row = next(p for p in c.get(BASE).json() if p["patient_id"] == world["asha_id"])
    assert row["added_by_you"] and not row["created_by_you"]
    # Remove from the list: the account stays.
    assert c.delete(f"{BASE}{world['asha_id']}/").status_code == 204
    assert world["asha_id"] not in [p["patient_id"] for p in c.get(BASE).json()]
    assert User.objects.filter(pk=world["asha"].pk).exists()


@pytest.mark.django_db
def test_both_the_hospital_and_the_patient_edit_health_details(world):
    c = client_for(world["desk"])
    pid = world["asha_id"]
    # Not in the list yet: open (logged) but not edit.
    assert c.get(f"{BASE}{pid}/").status_code == 200
    assert RecordAccess.objects.filter(patient=world["asha"], viewer=world["desk"]).exists()
    assert c.patch(f"{BASE}{pid}/", {"blood_group": "O+"}, format="json").status_code == 403
    c.post(f"{BASE}add/", {"patient_id": pid}, format="json")
    r = c.patch(f"{BASE}{pid}/", {"blood_group": "O+", "allergies": "Penicillin", "phone": "9000000001"}, format="json")
    assert r.status_code == 200, r.json()
    assert (r.json()["details"]["blood_group"], r.json()["details"]["allergies"]) == ("O+", "Penicillin")
    assert r.json()["patient"]["phone"] == "9000000001"
    # A patient the hospital didn't create keeps their own email.
    assert r.json()["patient"]["can_edit_email"] is False
    assert "own email" in str(c.patch(f"{BASE}{pid}/", {"email": "new@example.com"}, format="json").json())
    # The patient sees it and can change it too.
    me = client_for(world["asha"])
    assert me.get("/api/auth/me/patient/").json()["allergies"] == "Penicillin"
    me.patch("/api/auth/me/patient/", {"allergies": "Penicillin, dust"}, format="json")
    assert c.get(f"{BASE}{pid}/").json()["details"]["allergies"] == "Penicillin, dust"
    # Bad values are refused like on the patient's own form.
    assert c.patch(f"{BASE}{pid}/", {"height_cm": 900}, format="json").status_code == 400


@pytest.mark.django_db
def test_a_patient_with_a_visit_here_is_in_the_list_without_adding(world):
    user = User.objects.create_user("doc@example.com", "pw", role="doctor")
    doctor = DoctorProfile.objects.get(user=user)
    doctor.hospital = world["city"]
    doctor.save()
    start = timezone.now() + timedelta(days=1)
    Appointment.objects.create(patient=world["asha"], doctor=doctor, start=start, end=start + timedelta(minutes=30),
                               status="confirmed")
    c = client_for(world["desk"])
    row = next(p for p in c.get(BASE).json() if p["patient_id"] == world["asha_id"])
    assert not row["added_by_you"]
    assert c.patch(f"{BASE}{world['asha_id']}/", {"gender": "female"}, format="json").status_code == 200
    r = c.delete(f"{BASE}{world['asha_id']}/")
    assert r.status_code == 400  # patients with visits stay listed


@pytest.mark.django_db
def test_hospital_records_each_side_deletes_its_own_copy(world, django_capture_on_commit_callbacks):
    c, pid, asha = client_for(world["desk"]), world["asha_id"], world["asha"]
    assert upload(c, pid).status_code == 403  # add the patient first
    c.post(f"{BASE}add/", {"patient_id": pid}, format="json")
    with django_capture_on_commit_callbacks(execute=True):
        r = upload(c, pid)
    assert r.status_code == 201, r.json()
    rec_id = r.json()["id"]
    assert r.json()["uploaded_by_hospital_name"] == "City Hospital" and r.json()["can_delete"]
    assert Notification.objects.get(user=asha, kind="record_added").message == "City Hospital added “Blood test” to your records."

    # The patient sees it ("Uploaded by City Hospital"), can download it, but can't edit its details.
    me = client_for(asha)
    mine = me.get("/api/records/").json()
    assert [(x["id"], x["uploaded_by_hospital_name"]) for x in mine] == [(rec_id, "City Hospital")]
    assert me.get(f"/api/records/{rec_id}/file/").status_code == 200
    assert me.patch(f"/api/records/{rec_id}/", {"title": "Mine"}, format="json").status_code == 403

    # The patient deletes it: gone for them, the hospital keeps it.
    assert me.delete(f"/api/records/{rec_id}/").status_code == 204
    assert me.get("/api/records/").json() == []
    assert me.get(f"/api/records/{rec_id}/file/").status_code == 404
    assert [x["id"] for x in c.get(f"{BASE}{pid}/").json()["records"]] == [rec_id]
    assert c.get(f"/api/records/{rec_id}/file/").status_code == 200

    # Then the hospital deletes it too: the record (and file) are gone.
    assert c.delete(f"{BASE}{pid}/records/{rec_id}/").status_code == 204
    assert not MedicalRecord.objects.filter(pk=rec_id).exists()


@pytest.mark.django_db
def test_hospital_delete_keeps_the_patients_copy_and_only_own_uploads(world):
    c, pid, asha = client_for(world["desk"]), world["asha_id"], world["asha"]
    c.post(f"{BASE}add/", {"patient_id": pid}, format="json")
    rec_id = upload(c, pid).json()["id"]
    # The patient's own upload: the hospital sees it but can't delete it.
    own = client_for(asha).post("/api/records/", {"title": "X-ray", "record_type": "xray",
                                                   "file": SimpleUploadedFile("x.pdf", PDF, content_type="application/pdf")},
                                 format="multipart").json()["id"]
    page = {x["id"]: x for x in c.get(f"{BASE}{pid}/").json()["records"]}
    assert page[own]["can_delete"] is False and page[rec_id]["can_delete"] is True
    assert c.delete(f"{BASE}{pid}/records/{own}/").status_code == 404
    # Another hospital can't delete ours.
    other = client_for(world["other_desk"])
    other.post(f"{BASE}add/", {"patient_id": pid}, format="json")
    assert other.delete(f"{BASE}{pid}/records/{rec_id}/").status_code == 404

    # Hospital deletes its upload: gone from its list, the patient keeps it.
    assert c.delete(f"{BASE}{pid}/records/{rec_id}/").status_code == 204
    assert rec_id not in [x["id"] for x in c.get(f"{BASE}{pid}/").json()["records"]]
    assert rec_id in [x["id"] for x in client_for(asha).get("/api/records/").json()]
    # Other viewers (doctors, other hospitals) see what the patient keeps.
    assert rec_id in [x["id"] for x in other.get(f"{BASE}{pid}/").json()["records"]]


@pytest.mark.django_db
def test_the_list_shows_visited_date_hospital_records_and_payment(world):
    """Simple columns (owner request 2026-11-22): Visited (editable date), Records (ours), Payment."""
    c, pid, asha = client_for(world["desk"]), world["asha_id"], world["asha"]
    c.post(f"{BASE}add/", {"patient_id": pid}, format="json")
    row = lambda: next(r for r in c.get(BASE).json() if r["patient_id"] == pid)  # noqa: E731
    assert (row()["visit_on"], row()["visit_status"], row()["records"], row()["payment"]) == (None, None, 0, None)

    # The visit date is set and changed inside the patient's page; the status follows the date (owner request 2026-11-22).
    today = timezone.localdate()
    for when, status in ((today - timedelta(days=7), "past"), (today, "current"), (today + timedelta(days=5), "upcoming")):
        r = c.patch(f"{BASE}{pid}/", {"visit_on": when.isoformat()}, format="json")
        assert r.status_code == 200 and (r.json()["patient"]["visit_on"], r.json()["patient"]["visit_status"]) == (when.isoformat(), status)
        assert (row()["visit_on"], row()["visit_status"], row()["visit_set_by_you"]) == (when.isoformat(), status, True)
    assert "date like" in str(c.patch(f"{BASE}{pid}/", {"visit_on": "soon"}, format="json").json())
    c.patch(f"{BASE}{pid}/", {"visit_on": None}, format="json")
    assert row()["visit_on"] is None

    # Records: only what this hospital uploaded (not the patient's own, not deleted ones).
    client_for(asha).post("/api/records/", {"title": "Own", "record_type": "other",
                                            "file": SimpleUploadedFile("o.pdf", PDF, content_type="application/pdf")}, format="multipart")
    ours = upload(c, pid).json()["id"]
    upload(c, pid, title="Second")
    assert row()["records"] == 2
    c.delete(f"{BASE}{pid}/records/{ours}/")
    assert row()["records"] == 1

    # Payment: pending while anything is unpaid, completed when every slip is paid.
    items = [{"description": "Consultation", "unit_price": "500"}]
    a = c.post("/api/hospital-admin/payments/", {"patient_id": pid, "items": items}, format="json").json()
    assert (row()["payment"], row()["pending_amount"]) == ("pending", 500)
    c.post(f"/api/hospital-admin/payments/{a['id']}/complete/", {"method": "cash"}, format="json")
    assert (row()["payment"], row()["pending_amount"]) == ("completed", 0)
