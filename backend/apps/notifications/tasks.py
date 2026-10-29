"""Background jobs run by the Celery worker."""

import logging
from datetime import timedelta
from smtplib import SMTPException

from celery import shared_task
from django.db.models import F
from django.utils import timezone

from apps.appointments.models import Appointment

from .emails import send_appointment_email

log = logging.getLogger(__name__)


@shared_task(bind=True, autoretry_for=(SMTPException, OSError), retry_backoff=True, max_retries=5)
def send_appointment_email_task(self, appointment_id: int, event: str):
    """Send one appointment email. Retries with growing delays if the mail server is down."""
    try:
        appointment = Appointment.objects.select_related("patient", "doctor__user", "doctor__hospital").get(pk=appointment_id)
    except Appointment.DoesNotExist:
        return 0
    sent = send_appointment_email(appointment, event)
    log.info("Sent %s email(s) for appointment %s (%s)", sent, appointment_id, event)
    return sent


@shared_task
def send_due_reminders():
    """Runs every 5 minutes (Celery Beat). Sends 24-hour and 1-hour reminders exactly once."""
    now = timezone.now()
    active = Appointment.objects.active().filter(start__gt=now)
    queued = 0

    windows = [
        # Skip the 24h reminder if the booking was made less than 24h ahead.
        ("reminder_24h", "reminder_24h_sent_at", timedelta(hours=24), {"start__gt": F("created_at") + timedelta(hours=24)}),
        ("reminder_1h", "reminder_1h_sent_at", timedelta(hours=1), {}),
    ]
    for event, field, ahead, extra in windows:
        due = active.filter(start__lte=now + ahead, **{f"{field}__isnull": True}, **extra)
        for appt_id in due.values_list("id", flat=True):
            # "Claim" the reminder with a conditional UPDATE, so even if two schedulers
            # ran at once, only one of them would send it.
            claimed = Appointment.objects.filter(pk=appt_id, **{f"{field}__isnull": True}).update(**{field: now})
            if claimed:
                send_appointment_email_task.delay(appt_id, event)
                queued += 1
    return queued


@shared_task
def complete_past_appointments():
    """Runs hourly. Appointments that ended over an hour ago are marked completed."""
    cutoff = timezone.now() - timedelta(hours=1)
    return Appointment.objects.active().filter(end__lt=cutoff).update(status=Appointment.Status.COMPLETED)
