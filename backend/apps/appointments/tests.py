from datetime import date, time, timedelta

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.doctors.models import DoctorProfile, WeeklyAvailability
from apps.hospitals.models import Hospital

User = get_user_model()


def next_weekday():
    d = date.today() + timedelta(days=1)
    while d.weekday() > 4:
        d += timedelta(days=1)
    return d


@pytest.fixture
def doctor():
    user = User.objects.create_user("doc@example.com", "pw", role="doctor", first_name="Doc")
    profile = DoctorProfile.objects.get(user=user)  # created by the signal
    profile.hospital = Hospital.objects.create(name="Test Hospital", city="Chennai")
    profile.save()
    for wd in range(5):
        WeeklyAvailability.objects.create(doctor=profile, weekday=wd, start_time=time(9), end_time=time(10))
    return profile


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.mark.django_db
def test_slots_and_booking_flow(doctor):
    patient = User.objects.create_user("pat@example.com", "pw")
    day = next_weekday()

    slots = APIClient().get(f"/api/doctors/{doctor.id}/slots/?date={day}").data["slots"]
    assert len(slots) == 4  # 09:00–10:00 in 15-minute slots
    first = slots[0]["start"]

    res = client_for(patient).post("/api/appointments/", {"doctor": doctor.id, "start": first}, format="json")
    assert res.status_code == 201, res.data

    # Same slot again -> rejected
    other = User.objects.create_user("pat2@example.com", "pw")
    res = client_for(other).post("/api/appointments/", {"doctor": doctor.id, "start": first}, format="json")
    assert res.status_code == 400

    # Slot now shows as taken
    slots = APIClient().get(f"/api/doctors/{doctor.id}/slots/?date={day}").data["slots"]
    assert slots[0]["available"] is False

    # Doctor sees it; patient cancels; slot frees up
    assert len(client_for(doctor.user).get("/api/appointments/").data) == 1
    appt_id = client_for(patient).get("/api/appointments/").data[0]["id"]
    assert client_for(patient).post(f"/api/appointments/{appt_id}/cancel/").status_code == 200
    slots = APIClient().get(f"/api/doctors/{doctor.id}/slots/?date={day}").data["slots"]
    assert slots[0]["available"] is True


@pytest.mark.django_db
def test_cannot_book_outside_hours(doctor):
    patient = User.objects.create_user("pat@example.com", "pw")
    bad = f"{next_weekday()}T15:00:00+05:30"
    res = client_for(patient).post("/api/appointments/", {"doctor": doctor.id, "start": bad}, format="json")
    assert res.status_code == 400


@pytest.mark.django_db
def test_patients_only_see_their_own(doctor):
    a = User.objects.create_user("a@example.com", "pw")
    b = User.objects.create_user("b@example.com", "pw")
    start = APIClient().get(f"/api/doctors/{doctor.id}/slots/?date={next_weekday()}").data["slots"][0]["start"]
    client_for(a).post("/api/appointments/", {"doctor": doctor.id, "start": start}, format="json")
    assert len(client_for(b).get("/api/appointments/").data) == 0


@pytest.mark.django_db
def test_doctor_cannot_book(doctor):
    res = client_for(doctor.user).post("/api/appointments/", {"doctor": doctor.id, "start": "2030-01-01T09:00:00Z"}, format="json")
    assert res.status_code == 403
