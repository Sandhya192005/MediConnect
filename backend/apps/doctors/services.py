"""Turns a doctor's weekly hours into bookable time slots for a given date."""

from datetime import date, datetime, timedelta

from django.utils import timezone

from apps.appointments.models import Appointment

from .models import DoctorProfile


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
    start = timezone.localtime(start)
    return any(s["start"] == start and s["available"] for s in generate_slots(doctor, start.date()))
