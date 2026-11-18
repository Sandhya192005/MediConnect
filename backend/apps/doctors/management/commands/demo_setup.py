"""
Demo data for showing MediConnect (e.g. a project review). Clearly a demo: a made-up "MediConnect Demo
Hospital" and demo.*@mediconnect.dev accounts, never a real hospital's name.

    docker compose exec backend python manage.py demo_setup                  # random password
    docker compose exec backend python manage.py demo_setup --password ...   # your own password
    docker compose exec backend python manage.py demo_cleanup                # remove it all again

Creates (or resets) only its own data:
- the demo hospital (connected), two departments, two doctors with working hours, a hospital admin, staff
  records (the doctors + nurses) and three patients with health details;
- appointments made the same way the app makes them: completed visits in the past weeks, upcoming
  bookings, and today's queue (one patient checked in with token 1, one still to arrive).

Run it again on the day of the review: it rebuilds the calendar around "today". The logins are written to
backend/.demo-logins.json (gitignored) instead of being printed, so the password isn't left in a terminal log.
Refuses to run unless DEBUG is on.
"""

import json
import secrets
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import PatientProfile
from apps.appointments import queue
from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile, WeeklyAvailability
from apps.hospitals.models import Department, Hospital
from apps.staff.models import HospitalAdmin, StaffMember

User = get_user_model()
DEMO_DOMAIN = "@mediconnect.dev"
DEMO_PREFIX = "demo."
HOSPITAL_NAME = "MediConnect Demo Hospital"
LOGINS_FILE = Path(settings.BASE_DIR) / ".demo-logins.json"
OPEN, CLOSE = time(8), time(20)  # the demo doctors work 08:00–20:00 every day, so a live booking always works

DOCTORS = [
    # email, first, last, department, specialization, qualification, fee, years
    ("demo.doctor.cardio", "Kavya", "Raman", "Cardiology", "Cardiologist", "MBBS, MD, DM (Cardiology)", 800, 12),
    ("demo.doctor.general", "Arun", "Prakash", "General Medicine", "General Physician", "MBBS, MD", 500, 7),
]
PATIENTS = [
    # email, first, last, health details
    ("demo.patient.meena", "Meena", "Krishnan", dict(
        date_of_birth=date(1988, 3, 14), gender="female", height_cm=158, weight_kg=Decimal("61.5"), blood_group="B+",
        allergies="Penicillin (rash)", conditions=["high_bp"], current_medicines="Amlodipine 5 mg once a day",
        emergency_contact_name="Suresh Krishnan", emergency_contact_relation="Husband", emergency_contact_phone="90000 00001")),
    ("demo.patient.rahul", "Rahul", "Varma", dict(
        date_of_birth=date(1995, 9, 2), gender="male", height_cm=174, weight_kg=Decimal("72"), blood_group="O+",
        no_known_allergies=True, no_conditions=True, no_current_medicines=True,
        emergency_contact_name="Lakshmi Varma", emergency_contact_relation="Mother", emergency_contact_phone="90000 00002")),
    ("demo.patient.fathima", "Fathima", "Begum", dict(
        date_of_birth=date(1962, 11, 20), gender="female", height_cm=152, weight_kg=Decimal("68"), blood_group="A+",
        no_known_allergies=True, conditions=["diabetes", "thyroid"], current_medicines="Metformin 500 mg twice a day\nThyroxine 50 mcg",
        emergency_contact_name="Imran", emergency_contact_relation="Son", emergency_contact_phone="90000 00003")),
]
NURSES = [("Divya S", "Staff Nurse", 210, 28000), ("Ramesh K", "Staff Nurse", 120, 26000), ("Selvi M", "Head Nurse", 400, 38000)]


class Command(BaseCommand):
    help = "Create (or reset) clearly-labelled demo data for showing MediConnect"

    def add_arguments(self, parser):
        parser.add_argument("--password", help="Password for every demo account (default: a new random one)")

    def handle(self, *args, password=None, **options):
        if not settings.DEBUG:
            raise CommandError("demo_setup only runs with DEBUG=1 (it creates demo accounts).")
        password = password or f"Demo-{secrets.token_urlsafe(6)}-{secrets.randbelow(90) + 10}"

        with transaction.atomic():
            data = self._build(password)
        LOGINS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")

        self.stdout.write(f"Demo ready: {HOSPITAL_NAME}, {len(DOCTORS)} doctors, {len(PATIENTS)} patients, "
                          f"{data['appointments']['total']} appointments ({data['appointments']['today_queue']} in today's queue).")
        if data["appointments"]["today_queue"] == 0:
            self.stdout.write("No queue today: it's outside 08:00–20:00. Run demo_setup again on the review day.")
        self.stdout.write(f"Logins (all with the same password) are in {LOGINS_FILE.name} in the backend folder.")
        self._reindex()

    # ------------------------------------------------------------------ data

    def _build(self, password: str) -> dict:
        now = timezone.localtime()

        hospital, _ = Hospital.objects.update_or_create(
            name=HOSPITAL_NAME,
            defaults=dict(
                # No real address and an unverified pin: this hospital doesn't exist.
                address="Demo hospital (not a real address)", city="Chennai", state="Tamil Nadu", source="manual",
                is_approved=True, location=Point(80.2450, 13.0480, srid=4326), location_verified=False,
                website="", website_source="",
            ),
        )
        departments = {name: Department.objects.get_or_create(name=name)[0] for name in {d[3] for d in DOCTORS}}
        hospital.departments.add(*departments.values())

        # Doctors, with working hours and a fresh calendar.
        doctors = []
        for email, first, last, dept, spec, qual, fee, years in DOCTORS:
            user = self._user(email, "doctor", first, last, password)
            doc = DoctorProfile.objects.get(user=user)
            doc.hospital, doc.department, doc.specialization, doc.qualification = hospital, departments[dept], spec, qual
            doc.fee, doc.experience_years, doc.slot_minutes, doc.is_active = fee, years, 30, True
            doc.save()
            WeeklyAvailability.objects.filter(doctor=doc).delete()
            WeeklyAvailability.objects.bulk_create(
                [WeeklyAvailability(doctor=doc, weekday=d, start_time=OPEN, end_time=CLOSE) for d in range(7)])
            Appointment.objects.filter(doctor=doc).delete()
            doctors.append(doc)

        # Hospital admin ("Hospital" login tab) and staff records.
        admin = self._user("demo.hospital", "admin", "Hospital", "Manager", password)
        HospitalAdmin.objects.update_or_create(user=admin, defaults={"hospital": hospital})
        StaffMember.objects.filter(hospital=hospital).delete()
        today = now.date()
        for doc, (_, first, last, *_rest), joined, salary in zip(doctors, DOCTORS, (300, 150), (150000, 90000)):
            StaffMember.objects.create(hospital=hospital, kind="doctor", full_name=f"Dr. {first} {last}", doctor=doc,
                                       department=doc.department, designation="Consultant",
                                       join_date=today - timedelta(days=joined), monthly_salary=salary)
        for name, designation, joined, salary in NURSES:
            StaffMember.objects.create(hospital=hospital, kind="nurse", full_name=name, designation=designation,
                                       join_date=today - timedelta(days=joined), monthly_salary=salary)

        # Patients with health details.
        patients = []
        for email, first, last, health in PATIENTS:
            user = self._user(email, "patient", first, last, password)
            profile = PatientProfile.for_user(user)
            for field in ("allergies", "conditions_other", "current_medicines", "emergency_contact_name",
                          "emergency_contact_relation", "emergency_contact_phone", "blood_group", "gender"):
                setattr(profile, field, "")
            profile.conditions, profile.no_known_allergies, profile.no_conditions, profile.no_current_medicines = [], False, False, False
            for k, v in health.items():
                setattr(profile, k, v)
            profile.weight_updated_on, profile.health_updated_at = today, timezone.now()
            profile.save()
            patients.append(user)

        appts = self._appointments(doctors, patients, now)
        return {
            "note": "Demo accounts for showing MediConnect. Remove with: python manage.py demo_cleanup",
            "password": password,
            "logins": {
                "Patient tab": [p.email for p in patients],
                "Doctor tab": [d.user.email for d in doctors],
                "Hospital tab": [admin.email],
            },
            "patient_ids": {p.email: PatientProfile.for_user(p).patient_id for p in patients},
            "hospital": HOSPITAL_NAME,
            "appointments": appts,
        }

    def _appointments(self, doctors, patients, now) -> dict:
        tz = timezone.get_current_timezone()
        reasons = ["Follow-up", "Chest pain check", "Fever and cough", "BP review", "Sugar test review", "Routine check-up"]
        made = 0

        def book(doc, patient, start: datetime, status="booked", reason="", created_days_before=2):
            nonlocal made
            a = Appointment.objects.create(doctor=doc, patient=patient, start=start,
                                           end=start + timedelta(minutes=doc.slot_minutes), status=status, reason=reason)
            # Booked a couple of days before the visit, like a real booking (created_at is set automatically).
            Appointment.objects.filter(pk=a.pk).update(created_at=min(start, timezone.now()) - timedelta(days=created_days_before))
            made += 1
            return a

        def at(day: date, hour: int, minute: int = 0) -> datetime:
            return datetime.combine(day, time(hour, minute), tzinfo=tz)

        today = now.date()
        # Completed visits over the past weeks.
        for i, days_ago in enumerate([3, 6, 10, 14, 17, 21, 24, 28]):
            book(doctors[i % 2], patients[i % 3], at(today - timedelta(days=days_ago), 10 + i % 6, 30 * (i % 2)),
                 status="completed", reason=reasons[i % len(reasons)])
        # Upcoming bookings in the next days.
        for i, days_ahead in enumerate([1, 1, 2, 4, 6]):
            book(doctors[i % 2], patients[(i + 1) % 3], at(today + timedelta(days=days_ahead), 9 + 2 * i), reason=reasons[(i + 2) % len(reasons)])

        # Today's queue with the cardiologist: the next half-hour slots that are still ahead, inside working hours.
        first = (now + timedelta(minutes=30)).replace(minute=0 if now.minute < 30 else 30, second=0, microsecond=0)
        if now.minute >= 30:
            first += timedelta(minutes=30)
        today_queue = 0
        if OPEN <= first.time() and (first + timedelta(minutes=60)).time() <= CLOSE and first.date() == today:
            waiting = book(doctors[0], patients[0], first, reason="BP review", created_days_before=1)
            queue.check_in(waiting, by="doctor")  # the same rule the app uses: token 1 for the day
            book(doctors[0], patients[1], first + timedelta(minutes=30), reason="Chest pain check", created_days_before=1)
            today_queue = 2
        return {"total": made, "today_queue": today_queue}

    def _user(self, local, role, first, last, password):
        email = f"{local}{DEMO_DOMAIN}"
        user, _ = User.objects.get_or_create(email=email, defaults={"role": role})
        user.role, user.first_name, user.last_name, user.is_active = role, first, last, True
        user.set_password(password)
        user.save()
        return user

    def _reindex(self):
        try:
            from apps.search.documents import rebuild_all

            rebuild_all()
            self.stdout.write("Search index rebuilt.")
        except Exception as e:  # search down: the demo still works; rebuild later with search_index --rebuild
            self.stderr.write(f"Search index not rebuilt: {e}")
