"""
Fills the database with sample departments, hospitals, doctors and working hours.
Safe to run more than once.  Usage: python manage.py seed
"""

from datetime import time

from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.doctors.models import DoctorProfile, WeeklyAvailability
from apps.hospitals.models import Department, Hospital

User = get_user_model()
DOCTOR_PASSWORD = "Doctor@123"

DEPARTMENTS = [
    ("Cardiology", "Heart and blood vessels"),
    ("Dermatology", "Skin, hair and nails"),
    ("Orthopedics", "Bones, joints and muscles"),
    ("Pediatrics", "Children's health"),
    ("Neurology", "Brain and nervous system"),
    ("General Medicine", "Common illnesses and check-ups"),
    ("ENT", "Ear, nose and throat"),
    ("Gynecology", "Women's health"),
]

# Sample hospitals with approximate real coordinates (lat, lng).
HOSPITALS = [
    ("MediConnect City Hospital", "Anna Salai", "Chennai", "Tamil Nadu", 13.0604, 80.2496),
    ("Lakeside Multispeciality", "Velachery Main Rd", "Chennai", "Tamil Nadu", 12.9791, 80.2209),
    ("Green Valley Hospital", "MG Road", "Bengaluru", "Karnataka", 12.9756, 77.6050),
    ("Sunrise Children's Hospital", "Koramangala", "Bengaluru", "Karnataka", 12.9352, 77.6245),
    ("Harbour Care Hospital", "Marine Drive", "Mumbai", "Maharashtra", 18.9440, 72.8236),
]

# email, first, last, hospital index, department, specialization, fee, years
DOCTORS = [
    ("anita.rao", "Anita", "Rao", 0, "Cardiology", "Cardiologist", 800, 15),
    ("vikram.iyer", "Vikram", "Iyer", 0, "General Medicine", "General Physician", 400, 8),
    ("meera.nair", "Meera", "Nair", 1, "Dermatology", "Dermatologist", 600, 10),
    ("arjun.menon", "Arjun", "Menon", 1, "Orthopedics", "Orthopedic Surgeon", 700, 12),
    ("priya.shah", "Priya", "Shah", 2, "Neurology", "Neurologist", 900, 14),
    ("rahul.verma", "Rahul", "Verma", 2, "ENT", "ENT Specialist", 500, 6),
    ("kavya.reddy", "Kavya", "Reddy", 3, "Pediatrics", "Pediatrician", 550, 9),
    ("sana.khan", "Sana", "Khan", 4, "Gynecology", "Gynecologist", 750, 11),
    ("rohan.das", "Rohan", "Das", 4, "Cardiology", "Interventional Cardiologist", 1000, 18),
]

# Mon–Sat: 09:00–13:00 and 14:00–17:00
HOURS = [(d, time(9), time(13)) for d in range(6)] + [(d, time(14), time(17)) for d in range(6)]


class Command(BaseCommand):
    help = "Seed sample hospitals, departments and doctors"

    @transaction.atomic
    def handle(self, *args, **options):
        depts = {}
        for name, desc in DEPARTMENTS:
            depts[name], _ = Department.objects.get_or_create(name=name, defaults={"description": desc})

        hospitals = []
        for name, address, city, state, lat, lng in HOSPITALS:
            h, _ = Hospital.objects.update_or_create(
                name=name,
                defaults={
                    "address": address, "city": city, "state": state,
                    "location": Point(lng, lat, srid=4326), "phone": "+91 44 0000 0000",
                },
            )
            hospitals.append(h)

        for slug, first, last, h_idx, dept, spec, fee, years in DOCTORS:
            user, created = User.objects.get_or_create(
                email=f"{slug}@mediconnect.dev",
                defaults={"first_name": first, "last_name": last, "role": User.Role.DOCTOR},
            )
            if created:
                user.set_password(DOCTOR_PASSWORD)
                user.save()
            profile, _ = DoctorProfile.objects.update_or_create(
                user=user,
                defaults={
                    "hospital": hospitals[h_idx], "department": depts[dept], "specialization": spec,
                    "fee": fee, "experience_years": years, "qualification": "MBBS, MD",
                    "bio": f"{spec} with {years} years of experience.",
                },
            )
            hospitals[h_idx].departments.add(depts[dept])
            if not profile.availability.exists():
                WeeklyAvailability.objects.bulk_create(
                    WeeklyAvailability(doctor=profile, weekday=d, start_time=s, end_time=e) for d, s, e in HOURS
                )

        self.stdout.write(self.style.SUCCESS(
            f"Seeded {len(DEPARTMENTS)} departments, {len(HOSPITALS)} hospitals, {len(DOCTORS)} doctors. "
            f"Doctor logins: <name>@mediconnect.dev / {DOCTOR_PASSWORD}"
        ))
        transaction.on_commit(self._reindex)

    def _reindex(self):
        try:
            from apps.search.documents import rebuild_all

            counts = rebuild_all()
            self.stdout.write(self.style.SUCCESS(f"Search index rebuilt: {counts}"))
        except Exception as e:  # Elasticsearch not running yet
            self.stdout.write(self.style.WARNING(f"Skipped search index ({e}). Run: python manage.py search_index --rebuild"))
