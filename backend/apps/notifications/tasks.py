"""Background jobs run by the Celery worker."""

import logging
from datetime import timedelta
from smtplib import SMTPException

from celery import shared_task
from django.db.models import F
from django.utils import timezone

from apps.appointments.models import Appointment, ExternalAppointment

from .emails import send_appointment_email, send_external_reminder_email
from .realtime import notify_appointment_in_app

log = logging.getLogger(__name__)


def _load(appointment_id):
    return (
        Appointment.objects.select_related("patient", "doctor__user", "doctor__hospital")
        .filter(pk=appointment_id)
        .first()
    )


def queue_appointment_notifications(appointment_id: int, event: str):
    """Email and in-app run as separate tasks, so retrying a failed email never duplicates the bell item."""
    send_appointment_email_task.delay(appointment_id, event)
    push_in_app_notification_task.delay(appointment_id, event)


@shared_task
def push_in_app_notification_task(appointment_id: int, event: str):
    """Save a Notification row and push it over WebSocket to the user's open tabs."""
    appointment = _load(appointment_id)
    return notify_appointment_in_app(appointment, event) if appointment else 0


@shared_task(bind=True, autoretry_for=(SMTPException, OSError), retry_backoff=True, max_retries=5)
def send_appointment_email_task(self, appointment_id: int, event: str):
    """Send one appointment email. Retries with growing delays if the mail server is down."""
    appointment = _load(appointment_id)
    if not appointment:
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
                queue_appointment_notifications(appt_id, event)
                queued += 1

        # Same reminders for appointments the patient booked directly with a hospital.
        ext_due = ExternalAppointment.objects.filter(
            status=ExternalAppointment.Status.UPCOMING, start__gt=now, start__lte=now + ahead,
            **{f"{field}__isnull": True},
        ).filter(**extra)
        for ext_id in ext_due.values_list("id", flat=True):
            claimed = ExternalAppointment.objects.filter(pk=ext_id, **{f"{field}__isnull": True}).update(**{field: now})
            if claimed:
                send_external_reminder_task.delay(ext_id, event)  # email
                push_external_reminder_task.delay(ext_id, event)  # bell
                queued += 1
    return queued


@shared_task(bind=True, autoretry_for=(SMTPException, OSError), retry_backoff=True, max_retries=5)
def send_external_reminder_task(self, ext_id: int, event: str):
    ext = ExternalAppointment.objects.select_related("patient", "hospital").filter(pk=ext_id).first()
    if not ext or ext.status != ExternalAppointment.Status.UPCOMING:
        return 0
    return send_external_reminder_email(ext, event)


@shared_task
def push_external_reminder_task(ext_id: int, event: str):
    from .realtime import create_notification

    ext = ExternalAppointment.objects.select_related("patient", "hospital").filter(pk=ext_id).first()
    if not ext or ext.status != ExternalAppointment.Status.UPCOMING:
        return 0
    title = "Appointment tomorrow" if event == "reminder_24h" else "Appointment in 1 hour"
    when = timezone.localtime(ext.start).strftime("%a %d %b, %I:%M %p")
    who = f" with {ext.doctor_name}" if ext.doctor_name else ""
    create_notification(ext.patient, event, title, f"{ext.display_hospital}{who} · {when} (booked with the hospital)",
                        link="/patient/appointments")
    return 1


@shared_task
def complete_past_appointments():
    """Runs hourly. Appointments that ended over an hour ago are marked completed."""
    cutoff = timezone.now() - timedelta(hours=1)
    return Appointment.objects.active().filter(end__lt=cutoff).update(status=Appointment.Status.COMPLETED)
