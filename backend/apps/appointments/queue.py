"""
The patient queue on the day of a visit (Step 3).

    not_arrived ──check in──▶ waiting (gets a token: 1, 2, 3… per doctor per day)
                ──call in───▶ in_consultation (one at a time per doctor, enforced by the database)
                ──done──────▶ completed

- The patient checks in from the app ("I've arrived"), from 2 hours before their slot; the doctor can check
  them in any time that day.
- Each step locks the doctor's row (like booking does), so two patients checking in at the same moment
  can't get the same token.
- Queue events are in-app notifications only (no emails): "checked_in" goes to the doctor,
  "called_in" to the patient.
"""

from datetime import datetime, time, timedelta

from django.db import IntegrityError, transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.doctors.models import DoctorProfile

from .models import ACTIVE_STATUSES, Appointment

SELF_CHECK_IN_EARLY = timedelta(hours=2)


def day_bounds(day=None):
    """Start and end of a day in the app's time zone (Asia/Kolkata)."""
    day = day or timezone.localdate()
    start = timezone.make_aware(datetime.combine(day, time.min))
    return start, start + timedelta(days=1)


def appointments_on(doctor_id: int, day=None):
    start, end = day_bounds(day)
    # Bookings still waiting for the hospital aren't in the doctor's day yet.
    return Appointment.objects.filter(doctor_id=doctor_id, start__gte=start, start__lt=end, awaiting_hospital=False)


def _locked(appointment: Appointment) -> Appointment:
    """Locks the doctor, then re-reads the appointment, so queue changes for a doctor happen one at a time."""
    DoctorProfile.objects.select_for_update().get(pk=appointment.doctor_id)
    return Appointment.objects.select_for_update().select_related("patient", "doctor__user").get(pk=appointment.pk)


def _require_today_and_active(a: Appointment):
    if a.status not in ACTIVE_STATUSES:
        raise ValidationError({"status": f"This appointment is {a.status}."})
    if a.awaiting_hospital:
        raise ValidationError({"status": "The hospital hasn't confirmed this appointment yet."})
    if timezone.localtime(a.start).date() != timezone.localdate():
        raise ValidationError({"start": "The queue is only open on the day of the appointment."})


def check_in(appointment: Appointment, by: str) -> Appointment:
    """Puts the patient in the queue with the next token. Checking in twice changes nothing."""
    from apps.notifications.services import notify_queue

    with transaction.atomic():
        a = _locked(appointment)
        _require_today_and_active(a)
        if a.checked_in_at:
            return a
        now = timezone.now()
        if by == "patient" and now < a.start - SELF_CHECK_IN_EARLY:
            opens = timezone.localtime(a.start - SELF_CHECK_IN_EARLY).strftime("%I:%M %p").lstrip("0")
            raise ValidationError({"start": f"Check-in opens at {opens}, 2 hours before your appointment."})
        last = appointments_on(a.doctor_id).aggregate(m=Max("token"))["m"] or 0
        a.token, a.checked_in_at = last + 1, now
        a.save(update_fields=["token", "checked_in_at", "updated_at"])
        notify_queue(a, "checked_in")
    return a


def call_in(appointment: Appointment) -> Appointment:
    """The doctor calls a waiting patient in. Only one patient can be in consultation at a time."""
    from apps.notifications.services import notify_queue

    try:
        with transaction.atomic():
            a = _locked(appointment)
            _require_today_and_active(a)
            if a.consultation_started_at:
                return a
            if not a.checked_in_at:
                raise ValidationError({"status": "The patient hasn't checked in yet."})
            current = Appointment.objects.filter(
                doctor_id=a.doctor_id, status__in=ACTIVE_STATUSES, consultation_started_at__isnull=False
            ).first()
            if current:
                raise ValidationError({"status": f"Token {current.token} is still in consultation. Mark them done first."})
            a.consultation_started_at = timezone.now()
            a.save(update_fields=["consultation_started_at", "updated_at"])
            notify_queue(a, "called_in")
    except IntegrityError:  # the database rule caught a second consultation at the same moment
        raise ValidationError({"status": "Another patient is already in consultation. Mark them done first."})
    return a


def people_ahead(a: Appointment) -> int | None:
    """For a waiting patient: how many are ahead (waiting with a lower token, plus anyone in consultation)."""
    if a.queue_status != "waiting":
        return None
    today = appointments_on(a.doctor_id).filter(status__in=ACTIVE_STATUSES)
    waiting_ahead = today.filter(checked_in_at__isnull=False, consultation_started_at__isnull=True, token__lt=a.token)
    in_consultation = today.filter(consultation_started_at__isnull=False)
    return waiting_ahead.count() + in_consultation.count()


def queue_for(doctor_id: int, day=None) -> dict:
    """A doctor's day, grouped for the queue screen."""
    items = list(
        appointments_on(doctor_id, day)
        .exclude(status=Appointment.Status.CANCELLED)
        .select_related("patient__patient_profile", "doctor__user", "doctor__hospital")
    )
    by_status = {s: [a for a in items if a.queue_status == s] for s in ("in_consultation", "waiting", "not_arrived", "done")}
    by_status["waiting"].sort(key=lambda a: a.token)
    by_status["done"].sort(key=lambda a: (a.token is None, a.token or 0, a.start))
    return by_status
