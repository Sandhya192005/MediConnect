"""The test-data command used by the Playwright end-to-end tests (e2e/)."""

import json
from io import StringIO

import pytest
from django.core.management import CommandError, call_command

from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile
from apps.hospitals.models import Hospital


def run():
    out = StringIO()
    call_command("e2e_setup", stdout=out, stderr=StringIO())
    return json.loads(out.getvalue().strip().splitlines()[-1])


def test_refuses_without_debug(db, settings):
    settings.DEBUG = False
    with pytest.raises(CommandError):
        call_command("e2e_setup")
    assert not Hospital.objects.filter(name="E2E Partner Hospital").exists()


def test_can_run_again_and_resets_the_calendar(db, settings, django_user_model):
    settings.DEBUG = True
    first = run()
    doctor = DoctorProfile.objects.get(pk=first["doctor"]["id"])
    assert doctor.is_bookable and doctor.hospital.is_partner
    Appointment.objects.create(patient_id=first["patient"]["id"], doctor=doctor,
                               start="2030-01-01T10:00:00+05:30", end="2030-01-01T10:30:00+05:30")
    other = django_user_model.objects.create_user("someone@x.com", "pw")  # not an e2e account: must survive

    second = run()
    # Same ids every run, except the no-show test's missed visit: the calendar is wiped and that one
    # visit (two days ago, for "Mani Noshow") is made again, so it gets a new id (2026-11-21).
    first_visit, second_visit = first.pop("no_show").pop("appointment"), second["no_show"].pop("appointment")
    second_no_show = second.pop("no_show")
    assert second == first
    assert second_no_show == {"email": "e2e.noshow@mediconnect.dev", "name": "Mani Noshow"}
    assert second_visit != first_visit
    # The calendar was reset: the appointment added above is gone; only the fresh missed visit is left.
    assert list(Appointment.objects.filter(doctor=doctor).values_list("id", "status")) == [(second_visit, "completed")]
    assert Hospital.objects.filter(name="E2E Partner Hospital").count() == 1
    assert django_user_model.objects.filter(pk=other.pk).exists()
    assert Hospital.objects.get(pk=second["mock_hospital"]["id"]).website == "http://mockhospital/"
