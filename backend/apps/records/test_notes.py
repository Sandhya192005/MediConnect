"""Treatment notes (reference design, Part 3; owner decision 2026-11-19: the patient and any doctor read them)."""

from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import PatientProfile
from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile
from apps.hospitals.models import Hospital
from apps.records.models import RecordAccess, TreatmentNote

User = get_user_model()
URL = "/api/records/notes/"


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


def make_doctor(email, hospital, first):
    user = User.objects.create_user(email, "pw", role="doctor", first_name=first, last_name="Doc")
    doc = DoctorProfile.objects.get(user=user)
    doc.hospital, doc.is_active = hospital, True
    doc.save()
    return doc


def visit(patient, doctor, days=0, status="booked"):
    start = timezone.now().replace(microsecond=0) + timedelta(days=days)
    return Appointment.objects.create(patient=patient, doctor=doctor, start=start, end=start + timedelta(minutes=30), status=status)


@pytest.fixture
def world():
    hospital = Hospital.objects.create(name="City Hospital", city="Chennai", is_approved=True)
    patient = User.objects.create_user("asha@example.com", "pw", first_name="Asha")
    return {
        "hospital": hospital, "patient": patient,
        "doc": make_doctor("priya@example.com", hospital, "Priya"),
        "other": make_doctor("ravi@example.com", hospital, "Ravi"),
        "code": PatientProfile.for_user(patient).patient_id,
    }


NOTE = {"diagnosis": "  Viral   fever ", "advice": "Rest and fluids.",
        "medicines": [{"name": "Paracetamol 500 mg", "dose": "1 tablet", "frequency": "3 times a day", "days": 5}]}


@pytest.mark.django_db
def test_the_visits_doctor_writes_a_note_and_the_patient_reads_it(world):
    appt = visit(world["patient"], world["doc"])
    r = client_for(world["doc"].user).post(URL, {"appointment": appt.id, **NOTE}, format="json")
    assert r.status_code == 201, r.json()
    note = r.json()
    assert (note["diagnosis"], note["doctor_name"], note["hospital_name"], note["edited"]) == ("Viral fever", "Dr. Priya Doc", "City Hospital", False)
    assert note["medicines"] == [{"name": "Paracetamol 500 mg", "dose": "1 tablet", "frequency": "3 times a day", "days": 5}]

    mine = client_for(world["patient"]).get(URL).json()
    assert [n["diagnosis"] for n in mine] == ["Viral fever"]
    # The appointment says it has a note (for "Edit note" buttons).
    assert client_for(world["doc"].user).get(f"/api/appointments/{appt.id}/").json()["treatment_note"] == note["id"]
    # One note per visit.
    assert "already has a note" in str(client_for(world["doc"].user).post(URL, {"appointment": appt.id, **NOTE}, format="json").json())


@pytest.mark.django_db
def test_only_the_author_edits_and_patients_cannot_write(world):
    appt = visit(world["patient"], world["doc"])
    note_id = client_for(world["doc"].user).post(URL, {"appointment": appt.id, **NOTE}, format="json").json()["id"]

    r = client_for(world["doc"].user).patch(f"{URL}{note_id}/", {"advice": "Rest for 3 days."}, format="json")
    assert r.status_code == 200 and r.json()["advice"] == "Rest for 3 days."
    assert client_for(world["other"].user).patch(f"{URL}{note_id}/", {"advice": "x"}, format="json").status_code == 404
    assert client_for(world["patient"]).patch(f"{URL}{note_id}/", {"advice": "x"}, format="json").status_code == 403
    assert client_for(world["patient"]).post(URL, {"appointment": appt.id, **NOTE}, format="json").status_code == 403
    # Another doctor can't write a note for a visit that isn't theirs.
    appt2 = visit(world["patient"], world["doc"], days=-1, status="completed")
    r = client_for(world["other"].user).post(URL, {"appointment": appt2.id, **NOTE}, format="json")
    assert r.status_code == 400 and "your own patients" in str(r.json())


@pytest.mark.django_db
@pytest.mark.parametrize("change, message", [
    ({"diagnosis": "   "}, "diagnosis"),
    ({"follow_up_on": "2020-01-01"}, "past"),
    ({"medicines": [{"name": ""}]}, "name"),
    ({"medicines": [{"name": "X", "days": 0}]}, "days"),
    ({"medicines": [{"name": f"M{i}"} for i in range(21)]}, "At most 20"),
])
def test_bad_notes_are_refused(world, change, message):
    appt = visit(world["patient"], world["doc"])
    r = client_for(world["doc"].user).post(URL, {"appointment": appt.id, **NOTE, **change}, format="json")
    assert r.status_code == 400 and message in str(r.json())


@pytest.mark.django_db
def test_no_notes_for_future_cancelled_or_unconfirmed_visits(world):
    doc = client_for(world["doc"].user)
    future = visit(world["patient"], world["doc"], days=2)
    assert "day of the visit" in str(doc.post(URL, {"appointment": future.id, **NOTE}, format="json").json())
    cancelled = visit(world["patient"], world["doc"], days=-1, status="cancelled")
    assert "cancelled" in str(doc.post(URL, {"appointment": cancelled.id, **NOTE}, format="json").json())
    waiting = visit(world["patient"], world["doc"])
    Appointment.objects.filter(pk=waiting.pk).update(awaiting_hospital=True)
    assert "isn't confirmed" in str(doc.post(URL, {"appointment": waiting.id, **NOTE}, format="json").json())


@pytest.mark.django_db
def test_any_doctor_reads_notes_through_the_logged_patient_lookup(world):
    appt = visit(world["patient"], world["doc"])
    client_for(world["doc"].user).post(URL, {"appointment": appt.id, **NOTE}, format="json")

    other = client_for(world["other"].user)
    assert other.get(URL).json() == []  # their own notes list: only what they wrote
    body = other.get(f"/api/records/patients/{world['code']}/").json()
    assert [n["diagnosis"] for n in body["notes"]] == ["Viral fever"]
    assert RecordAccess.objects.filter(patient=world["patient"], viewer=world["other"].user).exists()  # logged

    # A patient never sees another patient's notes.
    stranger = User.objects.create_user("ravi.p@example.com", "pw")
    assert client_for(stranger).get(URL).json() == []
    assert TreatmentNote.objects.count() == 1
