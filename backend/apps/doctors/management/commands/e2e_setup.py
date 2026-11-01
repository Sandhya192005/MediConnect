"""
Fixed test data for the Playwright end-to-end tests (e2e/). Run before every test run:

    docker compose exec backend python manage.py e2e_setup

Creates (or resets) only its own e2e.* users and two E2E hospitals, then prints their ids as JSON.
It never touches other data, and refuses to run unless DEBUG is on (so never on a real server).
"""

import json
from datetime import time

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.appointments.models import Appointment, AppointmentRequest, ExternalAppointment
from apps.doctors.models import DoctorProfile, WeeklyAvailability
from apps.hospitals.models import Department, Hospital

User = get_user_model()
PASSWORD = "E2e@12345"
PATIENT_EMAIL = "e2e.patient@mediconnect.dev"
DOCTOR_EMAIL = "e2e.doctor@mediconnect.dev"
NEW_USER_PREFIX = "e2e.new."  # accounts created by the sign-up test, deleted on the next run
# Chennai, a few km from the real hospitals: the map test puts the browser here.
LAT, LNG = 13.0500, 80.2400


class Command(BaseCommand):
    help = "Reset the fixed data used by the Playwright end-to-end tests"

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("e2e_setup only runs with DEBUG=1 (it resets test accounts).")

        User.objects.filter(email__startswith=NEW_USER_PREFIX, email__endswith="@mediconnect.dev").delete()

        patient = self._user(PATIENT_EMAIL, "patient", "Esha", "Patient")
        doctor_user = self._user(DOCTOR_EMAIL, "doctor", "Eshwar", "Testdoctor")

        # A partner hospital with one bookable doctor who works every day, all day (so tests can always book).
        cardiology, _ = Department.objects.get_or_create(name="Cardiology")
        partner, _ = Hospital.objects.update_or_create(
            name="E2E Partner Hospital",
            defaults=dict(address="1 Test Street", city="Chennai", state="Tamil Nadu", source="manual",
                          is_approved=True, location=Point(LNG, LAT, srid=4326), location_verified=True),
        )
        partner.departments.add(cardiology)
        doctor = DoctorProfile.objects.get(user=doctor_user)
        doctor.hospital, doctor.department = partner, cardiology
        doctor.specialization, doctor.qualification, doctor.fee = "Cardiologist", "MBBS, MD", 700
        doctor.experience_years, doctor.slot_minutes, doctor.is_active = 9, 30, True
        doctor.save()
        WeeklyAvailability.objects.filter(doctor=doctor).delete()
        WeeklyAvailability.objects.bulk_create(
            [WeeklyAvailability(doctor=doctor, weekday=d, start_time=time(6), end_time=time(22)) for d in range(7)]
        )
        Appointment.objects.filter(doctor=doctor).delete()  # fresh calendar every run

        # Not a partner: its "website" is our mock hospital site (the only site tests may read).
        mock, _ = Hospital.objects.update_or_create(
            name="E2E Mock Website Hospital",
            defaults=dict(address="2 Test Street", city="Chennai", state="Tamil Nadu", source="scraped",
                          is_approved=False, website="http://mockhospital/", website_source="",
                          location=Point(LNG + 0.01, LAT, srid=4326), location_verified=False,
                          scraped_at=None, source_url="", booking_url="", scraped_info=None),
        )
        mock.scraped_doctors.all().delete()
        mock.scrape_jobs.all().delete()

        for user in (patient, doctor_user):
            user.notifications.all().delete()
            user.chat_sessions.all().delete()
        AppointmentRequest.objects.filter(patient=patient).delete()
        ExternalAppointment.objects.filter(patient=patient).delete()
        cache.delete(f"scrape:quota:{patient.id}")  # the website-read test must not hit the hourly limit
        cache.delete(f"chat:rl:{patient.id}")

        # Search index: update now instead of waiting for the background worker.
        transaction.on_commit(lambda: self._index(doctor.id, [partner.id, mock.id]))

        self.stdout.write(json.dumps({
            "password": PASSWORD,
            "patient": {"email": PATIENT_EMAIL, "id": patient.id},
            "doctor": {"email": DOCTOR_EMAIL, "id": doctor.id, "name": str(doctor)},
            "partner_hospital": {"id": partner.id, "name": partner.name},
            "mock_hospital": {"id": mock.id, "name": mock.name},
            "location": {"lat": LAT, "lng": LNG},
        }))

    def _user(self, email, role, first, last):
        user, _ = User.objects.get_or_create(email=email, defaults={"role": role})
        user.role, user.first_name, user.last_name, user.is_active = role, first, last, True
        user.set_password(PASSWORD)
        user.save()
        return user

    def _index(self, doctor_id, hospital_ids):
        from apps.search.documents import index_doctor, index_hospitals_bulk
        from apps.search.indexes import es, index_name

        try:
            index_hospitals_bulk(hospital_ids)
            index_doctor(doctor_id)
            es().indices.refresh(index=[index_name("doctors"), index_name("hospitals")])
        except Exception as e:  # search down: the search test will fail with a clear message, others still run
            self.stderr.write(f"Search index not updated: {e}")
