"""
Demo data for showing MediConnect (e.g. a project review). Clearly a demo: made-up hospitals that all have
"Demo" in their name, and demo.*@mediconnect.dev accounts. Never a real hospital's name.

    docker compose exec backend python manage.py demo_setup                  # random password
    docker compose exec backend python manage.py demo_setup --password ...   # your own password
    docker compose exec backend python manage.py demo_cleanup                # remove it all again

Creates (or resets) only its own data:
- five connected demo hospitals (four in Chennai, one in Coimbatore) with eleven doctors and their working
  hours. Two of them also have a hospital login with staff records, so the platform dashboard shows
  "connected hospitals" and "hospital accounts" as different numbers;
- three patients with health details;
- appointments made the way the app makes them: completed visits in the past weeks, upcoming bookings,
  and today's queue at the main demo hospital (one patient checked in with token 1, one still to arrive).

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
LOGINS_FILE = Path(settings.BASE_DIR) / ".demo-logins.json"

DAILY, MON_SAT = range(7), range(6)  # weekday 0 = Monday

# Each doctor: (email part, first, last, department, specialization, qualification, fee, years, days, open, close)
HOSPITALS = [
    {
        "name": "MediConnect Demo Hospital", "city": "Chennai", "lat": 13.0480, "lng": 80.2450,
        # The main demo hospital: open 08:00–20:00 every day, so a live booking during the review always works.
        "admin": ("demo.hospital", "Hospital", "Manager"),
        "nurses": [("Divya S", "Staff Nurse", 210, 28000), ("Ramesh K", "Staff Nurse", 120, 26000), ("Selvi M", "Head Nurse", 400, 38000)],
        # Other staff: (kind, name, job title, days since joining, monthly salary)
        "others": [("receptionist", "Kavitha J", "Front desk", 330, 18000), ("lab_technician", "Prakash V", "Senior Lab Technician", 280, 24000),
                   ("pharmacist", "Nisha R", "Pharmacist", 190, 26000), ("housekeeping", "Muthu S", "Housekeeping", 150, 14000),
                   ("security", "Rajan P", "Night security", 90, 15000), ("other", "Babu K", "Ambulance driver", 60, 17000)],
        "doctors": [
            ("cardio", "Kavya", "Raman", "Cardiology", "Cardiologist", "MBBS, MD, DM (Cardiology)", 800, 12, DAILY, 8, 20),
            ("general", "Arun", "Prakash", "General Medicine", "General Physician", "MBBS, MD", 500, 7, DAILY, 8, 20),
        ],
    },
    {
        "name": "Demo Children's Hospital", "city": "Chennai", "lat": 13.0850, "lng": 80.2100,
        "admin": ("demo.hospital.children", "Children's Hospital", "Manager"),
        "nurses": [("Priya R", "Paediatric Nurse", 300, 30000), ("Anitha V", "Staff Nurse", 90, 25000)],
        "others": [("receptionist", "Deepika M", "Front desk", 240, 17000), ("pharmacist", "Arjun K", "Pharmacist", 120, 25000),
                   ("office", "Sundar L", "Billing", 200, 21000)],
        "doctors": [
            ("peds1", "Nandini", "Iyer", "Pediatrics", "Pediatrician", "MBBS, DCH, MD (Pediatrics)", 600, 10, MON_SAT, 9, 17),
            ("peds2", "Karthik", "Subramanian", "Pediatrics", "Pediatric Neonatologist", "MBBS, MD, DM (Neonatology)", 900, 15, MON_SAT, 10, 18),
        ],
    },
    {
        "name": "Demo Bone & Joint Clinic", "city": "Chennai", "lat": 13.0050, "lng": 80.2550,
        "doctors": [
            ("ortho", "Vijay", "Shankar", "Orthopedics", "Orthopedic Surgeon", "MBBS, MS (Ortho)", 700, 14, MON_SAT, 9, 17),
            ("neuro", "Lakshmi", "Narayanan", "Neurology", "Neurologist", "MBBS, MD, DM (Neurology)", 1000, 18, MON_SAT, 9, 17),
        ],
    },
    {
        "name": "Demo Women's Care Hospital", "city": "Chennai", "lat": 13.1150, "lng": 80.2300,
        "doctors": [
            ("gyn", "Revathi", "Mohan", "Gynecology", "Gynecologist", "MBBS, MS (OG)", 650, 11, MON_SAT, 10, 18),
            ("derma", "Sana", "Ahmed", "Dermatology", "Dermatologist", "MBBS, MD (Dermatology)", 550, 6, MON_SAT, 10, 18),
        ],
    },
    {
        "name": "Demo Multispeciality Hospital", "city": "Coimbatore", "lat": 11.0170, "lng": 76.9560,
        "doctors": [
            ("cbe.general", "Ganesh", "Murthy", "General Medicine", "General Physician", "MBBS, MD", 400, 9, MON_SAT, 9, 18),
            ("cbe.ent", "Deepa", "Rao", "ENT", "ENT Specialist", "MBBS, MS (ENT)", 500, 8, MON_SAT, 9, 18),
            ("cbe.cardio", "Harish", "Kumar", "Cardiology", "Cardiologist", "MBBS, MD, DM (Cardiology)", 750, 13, MON_SAT, 9, 18),
        ],
    },
]
HOSPITAL_NAMES = [h["name"] for h in HOSPITALS]

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
REASONS = ["Follow-up", "Chest pain check", "Fever and cough", "BP review", "Sugar test review", "Routine check-up",
           "Knee pain", "Skin rash", "Child vaccination", "Headache"]


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

        n_doctors = sum(len(h["doctors"]) for h in HOSPITALS)
        self.stdout.write(f"Demo ready: {len(HOSPITALS)} hospitals, {n_doctors} doctors, {len(PATIENTS)} patients, "
                          f"{data['appointments']['total']} appointments ({data['appointments']['today_queue']} in today's queue).")
        if data["appointments"]["today_queue"] == 0:
            self.stdout.write("No queue today: it's outside 08:00–20:00. Run demo_setup again on the review day.")
        self.stdout.write(f"Logins (all with the same password) are in {LOGINS_FILE.name} in the backend folder.")
        self._reindex()

    # ------------------------------------------------------------------ data

    def _build(self, password: str) -> dict:
        now = timezone.localtime()
        today = now.date()
        doctors: list[DoctorProfile] = []
        admins: list[str] = []

        for spec in HOSPITALS:
            hospital, _ = Hospital.objects.update_or_create(
                name=spec["name"],
                defaults=dict(
                    # No real address and an unverified pin: these hospitals don't exist.
                    address="Demo hospital (not a real address)", city=spec["city"], state="Tamil Nadu", source="manual",
                    is_approved=True, location=Point(spec["lng"], spec["lat"], srid=4326), location_verified=False,
                    website="", website_source="",
                ),
            )
            here = []
            for part, first, last, dept, specialization, qual, fee, years, days, open_h, close_h in spec["doctors"]:
                department = Department.objects.get_or_create(name=dept)[0]
                hospital.departments.add(department)
                user = self._user(f"demo.doctor.{part}", "doctor", first, last, password)
                doc = DoctorProfile.objects.get(user=user)
                doc.hospital, doc.department, doc.specialization, doc.qualification = hospital, department, specialization, qual
                doc.fee, doc.experience_years, doc.slot_minutes, doc.is_active = fee, years, 30, True
                doc.save()
                WeeklyAvailability.objects.filter(doctor=doc).delete()
                WeeklyAvailability.objects.bulk_create(
                    [WeeklyAvailability(doctor=doc, weekday=d, start_time=time(open_h), end_time=time(close_h)) for d in days])
                Appointment.objects.filter(doctor=doc).delete()  # fresh calendar every run
                doc.demo_days = set(days)  # used below to book only on working days
                here.append(doc)
            doctors += here

            # Hospital login ("Hospital" tab) with staff records, for the hospitals that run their management here.
            StaffMember.objects.filter(hospital=hospital).delete()
            if "admin" in spec:
                # The hospital itself is the account (2026-11-19): role "hospital", named after the hospital,
                # and its login email is the hospital's email.
                local = spec["admin"][0]
                admin = self._user(local, "hospital", hospital.name[:150], "", password)
                HospitalAdmin.objects.update_or_create(user=admin, defaults={"hospital": hospital})
                Hospital.objects.filter(pk=hospital.pk).update(email=admin.email)
                admins.append(admin.email)
                for i, doc in enumerate(here):
                    StaffMember.objects.create(
                        hospital=hospital, kind="doctor", full_name=f"Dr. {doc.user.first_name} {doc.user.last_name}",
                        doctor=doc, department=doc.department, designation="Consultant",
                        join_date=today - timedelta(days=300 - 120 * i), monthly_salary=60000 + doc.fee * 100)
                for name, designation, joined, salary in spec["nurses"]:
                    StaffMember.objects.create(hospital=hospital, kind="nurse", full_name=name, designation=designation,
                                               join_date=today - timedelta(days=joined), monthly_salary=salary)
                for kind, name, designation, joined, salary in spec.get("others", []):
                    StaffMember.objects.create(hospital=hospital, kind=kind, full_name=name, designation=designation,
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
                "Doctor tab": {d.user.email: f"Dr. {d.user.first_name} {d.user.last_name}, {d.specialization}, {d.hospital.name}"
                               for d in doctors},
                "Hospital tab": admins,
            },
            "patient_ids": {p.email: PatientProfile.for_user(p).patient_id for p in patients},
            "hospitals": HOSPITAL_NAMES,
            "appointments": appts,
        }

    def _appointments(self, doctors, patients, now) -> dict:
        tz = timezone.get_current_timezone()
        made = 0

        def book(doc, patient, start: datetime, status="booked", reason="", created_days_before=2, awaiting=False):
            nonlocal made
            a = Appointment.objects.create(doctor=doc, patient=patient, start=start, awaiting_hospital=awaiting,
                                           source="hospital" if awaiting else "personal",
                                           end=start + timedelta(minutes=doc.slot_minutes), status=status, reason=reason)
            # Booked a couple of days before the visit, like a real booking (created_at is set automatically).
            Appointment.objects.filter(pk=a.pk).update(created_at=min(start, timezone.now()) - timedelta(days=created_days_before))
            made += 1
            return a

        def working_day(doc, day: date, step: int) -> date:
            """The nearest day (moving by `step`) on which this doctor works."""
            while day.weekday() not in doc.demo_days:
                day += timedelta(days=step)
            return day

        def at(day: date, hour: int, minute: int = 0) -> datetime:
            return datetime.combine(day, time(hour, minute), tzinfo=tz)

        today = now.date()
        # Completed visits over the past weeks, spread over the doctors (10:00–15:30 fits everyone's hours).
        for i, days_ago in enumerate([2, 3, 5, 6, 8, 10, 12, 14, 15, 17, 19, 21, 24, 26, 28]):
            doc = doctors[i % len(doctors)]
            day = working_day(doc, today - timedelta(days=days_ago), -1)
            book(doc, patients[i % 3], at(day, 10 + i % 6, 30 * (i % 2)), status="completed", reason=REASONS[i % len(REASONS)])
        # Upcoming bookings in the next days.
        for i, days_ahead in enumerate([1, 1, 2, 3, 4, 5, 6, 7]):
            doc = doctors[(i * 3) % len(doctors)]
            day = working_day(doc, today + timedelta(days=days_ahead), 1)
            book(doc, patients[(i + 1) % 3], at(day, 10 + i % 6), reason=REASONS[(i + 3) % len(REASONS)])

        # Two new bookings waiting for the main hospital's Confirm (its "confirm bookings first" switch is on),
        # to show the hospital Appointments page during the review.
        for hour, patient, reason in [(15, patients[2], "Sugar test review"), (16, patients[1], "Fever and cough")]:
            book(doctors[1], patient, at(today + timedelta(days=2), hour), reason=reason, created_days_before=0, awaiting=True)

        # Today's queue with the main hospital's cardiologist (08:00–20:00): the next half-hour slots still ahead.
        cardio = doctors[0]
        first = (now + timedelta(minutes=30)).replace(minute=0 if now.minute < 30 else 30, second=0, microsecond=0)
        if now.minute >= 30:
            first += timedelta(minutes=30)
        today_queue = 0
        if time(8) <= first.time() and (first + timedelta(minutes=60)).time() <= time(20) and first.date() == today:
            waiting = book(cardio, patients[0], first, reason="BP review", created_days_before=1)
            queue.check_in(waiting, by="doctor")  # the same rule the app uses: token 1 for the day
            book(cardio, patients[1], first + timedelta(minutes=30), reason="Chest pain check", created_days_before=1)
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
