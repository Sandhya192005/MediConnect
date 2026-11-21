from datetime import timedelta
from pathlib import Path

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import PatientProfile
from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile
from apps.hospitals.models import Hospital
from apps.records.models import MedicalRecord, RecordAccess

User = get_user_model()
PDF = b"%PDF-1.4\n% a tiny test file\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


@pytest.fixture(autouse=True)
def private_media(settings, tmp_path):
    """Uploaded files go to a temporary folder, never the real volume."""
    settings.PRIVATE_MEDIA_ROOT = str(tmp_path)
    return tmp_path


def client_for(user=None):
    c = APIClient()
    if user:
        c.force_authenticate(user)
    return c


def make_doctor(email, hospital):
    user = User.objects.create_user(email, "pw", role="doctor", first_name="Priya", last_name="Raman")
    profile = DoctorProfile.objects.get(user=user)
    profile.hospital = hospital
    profile.save()
    return user, profile


def book(patient, doctor_profile, status="booked", days=1):
    start = timezone.now() + timedelta(days=days)
    return Appointment.objects.create(patient=patient, doctor=doctor_profile, start=start,
                                      end=start + timedelta(minutes=30), status=status)


def upload(client, name="blood-test.pdf", content=PDF, **extra):
    data = {"title": "Blood test", "record_type": "lab_report", "file": SimpleUploadedFile(name, content), **extra}
    return client.post("/api/records/", data, format="multipart")


@pytest.fixture
def world():
    """A patient with a record, and doctors at the patient's hospital and at another hospital."""
    city = Hospital.objects.create(name="City Hospital", city="Chennai")
    other = Hospital.objects.create(name="Other Hospital", city="Chennai")
    patient = User.objects.create_user("asha@example.com", "pw", first_name="Asha", last_name="K")
    treating_user, treating = make_doctor("treating@example.com", city)
    colleague_user, _ = make_doctor("colleague@example.com", city)  # same hospital, never met the patient
    stranger_user, _ = make_doctor("stranger@example.com", other)
    book(patient, treating)
    assert upload(client_for(patient)).status_code == 201
    return {
        "patient": patient, "code": PatientProfile.objects.get(user=patient).patient_id,
        "record": MedicalRecord.objects.get(patient=patient),
        "treating": treating_user, "colleague": colleague_user, "stranger": stranger_user, "hospital": city,
    }


# ---- Patient IDs ----

@pytest.mark.django_db
def test_new_patients_get_a_patient_id_and_see_it_in_me():
    r = client_for().post("/api/auth/register/", {"email": "new@example.com", "password": "Strong@pass1",
                                                  "first_name": "New", "last_name": "Patient"}, format="json")
    assert r.status_code == 201
    user = User.objects.get(email="new@example.com")
    code = PatientProfile.objects.get(user=user).patient_id
    assert code.startswith("P") and len(code) == 7 and code[1:].isdigit()
    assert client_for(user).get("/api/auth/me/").json()["patient_id"] == code


@pytest.mark.django_db
def test_doctors_have_no_patient_id():
    doc, _ = make_doctor("doc@example.com", None)
    assert client_for(doc).get("/api/auth/me/").json()["patient_id"] is None
    assert not PatientProfile.objects.filter(user=doc).exists()


# ---- Uploads ----

@pytest.mark.django_db
def test_patient_uploads_a_record_and_the_file_is_stored_privately(private_media):
    patient = User.objects.create_user("p@example.com", "pw")
    r = upload(client_for(patient), record_date="2026-11-01", notes="Fasting")
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["title"] == "Blood test" and body["record_type_label"] == "Lab report"
    assert body["original_name"] == "blood-test.pdf" and body["content_type"] == "application/pdf"
    assert "file" not in body  # no link to the file in any response

    record = MedicalRecord.objects.get()
    stored = Path(private_media) / record.file.name
    assert stored.read_bytes() == PDF
    assert stored.name != "blood-test.pdf"  # stored under a random name
    with pytest.raises(ValueError):
        record.file.url  # private storage has no public URL


@pytest.mark.django_db
def test_png_and_jpg_are_accepted():
    c = client_for(User.objects.create_user("p@example.com", "pw"))
    assert upload(c, name="xray.png", content=PNG).status_code == 201
    assert upload(c, name="scan.JPG", content=b"\xff\xd8\xff\xe0" + b"\x00" * 16).status_code == 201


@pytest.mark.django_db
@pytest.mark.parametrize("name,content,message", [
    ("virus.exe", b"MZ\x90\x00", "Only PDF, JPG and PNG"),
    ("report.pdf", b"MZ\x90\x00 really a program", "doesn't look like a real PDF"),
    ("photo.png", PDF, "doesn't look like a real PNG"),
    ("empty.pdf", b"", "empty"),
])
def test_bad_files_are_rejected(name, content, message):
    r = upload(client_for(User.objects.create_user("p@example.com", "pw")), name=name, content=content)
    assert r.status_code == 400
    assert message in str(r.json())
    assert not MedicalRecord.objects.exists()


@pytest.mark.django_db
def test_too_large_files_are_rejected(settings):
    settings.RECORD_MAX_BYTES = 1024 * 1024
    r = upload(client_for(User.objects.create_user("p@example.com", "pw")), content=PDF + b"0" * 1024 * 1024)
    assert r.status_code == 400 and "too large" in str(r.json())


@pytest.mark.django_db
def test_future_dates_and_blank_titles_are_rejected():
    c = client_for(User.objects.create_user("p@example.com", "pw"))
    tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
    assert "future" in str(upload(c, record_date=tomorrow).json())
    assert upload(c, title="   ").status_code == 400


@pytest.mark.django_db
def test_patient_can_edit_details_but_not_swap_the_file(world):
    c = client_for(world["patient"])
    rid = world["record"].id
    r = c.patch(f"/api/records/{rid}/", {"title": "Blood test (HbA1c)", "record_type": "lab_report"}, format="json")
    assert r.status_code == 200 and r.json()["title"] == "Blood test (HbA1c)"
    before = MedicalRecord.objects.get(id=rid).file.name
    c.patch(f"/api/records/{rid}/", {"file": SimpleUploadedFile("x.pdf", PDF)}, format="multipart")
    assert MedicalRecord.objects.get(id=rid).file.name == before


# ---- Patients only see their own ----

@pytest.mark.django_db
def test_patients_only_see_their_own_records(world):
    other = client_for(User.objects.create_user("other@example.com", "pw"))
    rid = world["record"].id
    assert other.get("/api/records/").json() == []
    assert other.get(f"/api/records/{rid}/").status_code == 404
    assert other.get(f"/api/records/{rid}/file/").status_code == 404
    assert other.delete(f"/api/records/{rid}/").status_code == 404
    assert MedicalRecord.objects.filter(id=rid).exists()


@pytest.mark.django_db
def test_patient_downloads_their_own_file_without_a_log_entry(world):
    r = client_for(world["patient"]).get(f"/api/records/{world['record'].id}/file/")
    assert r.status_code == 200
    assert b"".join(r.streaming_content) == PDF
    assert r["Content-Type"] == "application/pdf"
    assert r["Content-Disposition"].startswith("attachment")
    assert "no-store" in r["Cache-Control"]
    assert not RecordAccess.objects.exists()


@pytest.mark.django_db
def test_deleting_a_record_removes_its_file(world, private_media, django_capture_on_commit_callbacks):
    stored = Path(private_media) / world["record"].file.name
    assert stored.exists()
    with django_capture_on_commit_callbacks(execute=True):
        assert client_for(world["patient"]).delete(f"/api/records/{world['record'].id}/").status_code == 204
    assert not stored.exists()


@pytest.mark.django_db
def test_logged_out_users_get_401():
    assert client_for().get("/api/records/").status_code == 401
    assert client_for().get("/api/records/patients/P123456/").status_code == 401


# ---- Doctors ----

@pytest.mark.django_db
def test_doctor_at_the_patients_hospital_can_open_records_and_it_is_logged(world):
    doc = client_for(world["treating"])
    r = doc.get(f"/api/records/patients/{world['code'].lower()}/")  # IDs are case-insensitive
    assert r.status_code == 200
    body = r.json()
    assert body["patient"] == {"patient_id": world["code"], "name": "Asha K"}
    assert body["hospital"] == "City Hospital"
    assert [rec["title"] for rec in body["records"]] == ["Blood test"]

    f = doc.get(f"/api/records/{world['record'].id}/file/")
    assert f.status_code == 200 and b"".join(f.streaming_content) == PDF

    log = client_for(world["patient"]).get("/api/records/access-log/").json()
    assert [e["action"] for e in log] == ["download", "view_list"]  # newest first
    assert log[0]["viewer_name"] == "Priya Raman" and log[0]["hospital_name"] == "City Hospital"
    assert log[0]["record_title"] == "Blood test"


@pytest.mark.django_db
def test_a_quick_repeat_is_logged_once_but_a_later_visit_is_logged_again(world):
    doc = client_for(world["treating"])
    url = f"/api/records/patients/{world['code']}/"
    doc.get(url)
    doc.get(url)  # page reload a moment later
    assert RecordAccess.objects.count() == 1
    RecordAccess.objects.update(created_at=timezone.now() - timedelta(minutes=2))
    doc.get(url)
    assert RecordAccess.objects.count() == 2


@pytest.mark.django_db
def test_the_patient_id_is_general_any_doctor_can_open_the_records(world):
    # Owner decision 2026-11-17: no appointment or hospital needed. Still logged.
    Appointment.objects.filter(patient=world["patient"]).delete()  # no visits anywhere
    for user in (world["stranger"], world["colleague"]):  # another hospital; same hospital, never met
        c = client_for(user)
        assert c.get(f"/api/records/patients/{world['code']}/").status_code == 200
        assert c.get(f"/api/records/{world['record'].id}/file/").status_code == 200
    assert RecordAccess.objects.filter(viewer=world["stranger"], hospital_name="Other Hospital").count() == 2


@pytest.mark.django_db
def test_a_doctor_or_admin_without_a_hospital_can_open_them_too(world):
    loner, _ = make_doctor("loner@example.com", None)
    admin = User.objects.create_user("admin@example.com", "pw", role="admin")
    for user in (loner, admin):
        r = client_for(user).get(f"/api/records/patients/{world['code']}/")
        assert r.status_code == 200 and r.json()["hospital"] is None
    assert RecordAccess.objects.filter(viewer=admin, viewer_role="admin", hospital_name="").count() == 1


@pytest.mark.django_db
def test_an_unknown_id_is_404(world):
    r = client_for(world["treating"]).get("/api/records/patients/P000000/")
    assert r.status_code == 404 and r.json() == {"detail": "No patient with this ID."}


@pytest.mark.django_db
def test_other_patients_still_cannot_read_a_patients_records(world):
    other = client_for(User.objects.create_user("other2@example.com", "pw"))
    assert other.get(f"/api/records/patients/{world['code']}/").status_code == 403
    assert other.get(f"/api/records/{world['record'].id}/file/").status_code == 404


@pytest.mark.django_db
def test_doctors_and_admins_cannot_use_the_patient_endpoints(world):
    admin = User.objects.create_user("admin@example.com", "pw", role="admin")
    for user in (world["treating"], admin):
        c = client_for(user)
        assert c.get("/api/records/").status_code == 403
        assert upload(c).status_code == 403
        assert c.patch(f"/api/records/{world['record'].id}/", {"title": "x"}, format="json").status_code == 403


@pytest.mark.django_db
def test_patient_id_lookups_are_rate_limited(world, monkeypatch):
    from rest_framework.throttling import ScopedRateThrottle

    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", {"record_lookup": "2/min"})
    doc = client_for(world["stranger"])
    codes = [doc.get(f"/api/records/patients/P{n}/").status_code for n in range(100000, 100003)]
    assert codes == [404, 404, 429]


@pytest.mark.django_db
def test_doctors_see_the_patients_health_details_with_the_records(world):
    profile = PatientProfile.objects.get(user=world["patient"])
    profile.height_cm, profile.weight_kg, profile.blood_group = 170, 72, "B+"
    profile.allergies = "Sulfa drugs"
    profile.save()

    details = client_for(world["treating"]).get(f"/api/records/patients/{world['code']}/").json()["details"]
    assert (details["blood_group"], details["bmi"], details["allergies"]) == ("B+", 24.9, "Sulfa drugs")
    # Read-only for doctors: the only way to change them is the patient's own settings.
    assert client_for(world["treating"]).patch("/api/auth/me/patient/", {"allergies": ""}, format="json").status_code == 403
