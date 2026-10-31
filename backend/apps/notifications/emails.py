"""Builds the email for each appointment event and sends it to the right people."""

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone

# event -> (who gets it, subject, headline, message)
EVENTS = {
    "booked": (
        ["patient", "doctor"],
        "Appointment booked",
        "Your appointment is booked",
        "We've reserved your slot. The doctor will confirm it shortly.",
    ),
    "confirmed": (
        ["patient"],
        "Appointment confirmed",
        "Your appointment is confirmed",
        "The doctor has confirmed your appointment. See you there!",
    ),
    "cancelled": (
        ["patient", "doctor"],
        "Appointment cancelled",
        "This appointment was cancelled",
        "The appointment below has been cancelled. You can book another slot any time.",
    ),
    "reminder_24h": (
        ["patient"],
        "Reminder: appointment tomorrow",
        "Your appointment is tomorrow",
        "Just a reminder about your appointment in about 24 hours.",
    ),
    "reminder_1h": (
        ["patient"],
        "Reminder: appointment in 1 hour",
        "Your appointment is in 1 hour",
        "Please arrive 10 minutes early and bring any previous reports.",
    ),
}


def send_external_reminder_email(ext, event: str) -> int:
    """Reminder for an appointment the patient booked directly with a hospital."""
    user = ext.patient
    if not user.email:
        return 0
    when = timezone.localtime(ext.start).strftime("%A, %d %B %Y at %I:%M %p")
    _, subject, headline, message = EVENTS[event]
    context = {
        "greeting_name": user.first_name or user.email,
        "headline": headline,
        "message": message + " You booked this directly with the hospital, so contact them for any changes.",
        "doctor": ext.doctor_name or "—",
        "specialization": "",
        "hospital": ext.display_hospital,
        "when": when,
        "reason": ext.notes,
        "status": "Booked directly with the hospital – added by you",
        "link": f"{settings.FRONTEND_URL}/patient/appointments",
    }
    email = EmailMultiAlternatives(
        f"MediConnect – {subject}", render_to_string("emails/appointment.txt", context),
        settings.DEFAULT_FROM_EMAIL, [user.email],
    )
    email.attach_alternative(render_to_string("emails/appointment.html", context), "text/html")
    return email.send()


def send_appointment_email(appointment, event: str) -> int:
    recipients, subject, headline, message = EVENTS[event]
    patient = appointment.patient
    doctor_user = appointment.doctor.user
    hospital = appointment.doctor.hospital
    start = timezone.localtime(appointment.start)

    sent = 0
    for who in recipients:
        user = patient if who == "patient" else doctor_user
        if not user.email:
            continue
        context = {
            "greeting_name": user.first_name or user.email,
            "headline": headline if who == "patient" else headline.replace("Your appointment", "An appointment"),
            "message": message if who == "patient" else f"Patient: {patient.get_full_name() or patient.email}",
            "doctor": str(appointment.doctor),
            "specialization": appointment.doctor.specialization,
            "hospital": f"{hospital.name}, {hospital.city}" if hospital else "",
            "when": start.strftime("%A, %d %B %Y at %I:%M %p"),
            "reason": appointment.reason,
            "status": appointment.get_status_display(),
            "link": f"{settings.FRONTEND_URL}/{'patient' if who == 'patient' else 'doctor'}/appointments",
        }
        text = render_to_string("emails/appointment.txt", context)
        html = render_to_string("emails/appointment.html", context)
        email = EmailMultiAlternatives(f"MediConnect – {subject}", text, settings.DEFAULT_FROM_EMAIL, [user.email])
        email.attach_alternative(html, "text/html")
        sent += email.send()
    return sent
