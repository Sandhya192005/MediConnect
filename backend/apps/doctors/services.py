"""Turns a doctor's weekly hours into bookable time slots for a given date."""

from datetime import date, datetime, timedelta

from django.core.cache import cache
from django.utils import timezone

from apps.appointments.models import Appointment

from .models import DoctorProfile

SLOT_CACHE_SECONDS = 60


def generate_slots(doctor: DoctorProfile, day: date) -> list[dict]:
    tz = timezone.get_current_timezone()
    now = timezone.now()
    step = timedelta(minutes=doctor.slot_minutes)

    taken = set(
        Appointment.objects.active()
        .filter(doctor=doctor, start__date=day)
        .values_list("start", flat=True)
    )

    slots = []
    for block in doctor.availability.filter(weekday=day.weekday()):
        start = datetime.combine(day, block.start_time, tzinfo=tz)
        end = datetime.combine(day, block.end_time, tzinfo=tz)
        while start + step <= end:
            slots.append({"start": start, "end": start + step, "available": start > now and start not in taken})
            start += step
    return slots


def is_slot_available(doctor: DoctorProfile, start: datetime) -> bool:
    """Always checks the database directly (never the cache) — used when booking."""
    start = timezone.localtime(start)
    return any(s["start"] == start and s["available"] for s in generate_slots(doctor, start.date()))


# --- Redis cache for the public slots endpoint ---------------------------------
# Each doctor has a "version" number in the cache. Cache keys include it, so bumping
# the version instantly makes all of that doctor's cached slot lists stale.

def _version_key(doctor_id: int) -> str:
    return f"slots:ver:{doctor_id}"


def cached_slots(doctor: DoctorProfile, day: date) -> list[dict]:
    version = cache.get_or_set(_version_key(doctor.id), 1, timeout=None)
    key = f"slots:{doctor.id}:{version}:{day.isoformat()}"
    slots = cache.get(key)
    if slots is None:
        slots = generate_slots(doctor, day)
        cache.set(key, slots, SLOT_CACHE_SECONDS)
    return slots


def invalidate_slots(doctor_id: int) -> None:
    """Call after a booking, cancellation, or change to working hours/slot length."""
    try:
        cache.incr(_version_key(doctor_id))
    except ValueError:  # key missing -> nothing cached yet
        cache.set(_version_key(doctor_id), 1, timeout=None)
