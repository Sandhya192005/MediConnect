"""Creates in-app notifications and pushes them to the user's open browser tabs."""

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.utils import timezone

from .models import Notification
from .serializers import NotificationSerializer


def user_group(user_id: int) -> str:
    """Every browser tab of a user joins this Channels group."""
    return f"user_{user_id}"


def push_to_user(user_id: int, payload: dict) -> None:
    # The consumer method `notify` receives this (type "notify" -> method notify).
    async_to_sync(get_channel_layer().group_send)(user_group(user_id), {"type": "notify", "payload": payload})


def create_notification(user, kind, title, message, link="", appointment=None) -> Notification:
    n = Notification.objects.create(
        user=user, kind=kind, title=title, message=message, link=link, appointment=appointment
    )
    unread = Notification.objects.filter(user=user, is_read=False).count()
    push_to_user(user.id, {"type": "notification", "notification": NotificationSerializer(n).data, "unread": unread})
    return n


# Events that go to the hospital's account too (in-app only).
HOSPITAL_EVENTS = ("requested", "request_cancelled", "doctor_rejected", "doctor_accepted")


def notify_appointment_in_app(appointment, event: str) -> int:
    patient = appointment.patient
    doctor_user = appointment.doctor.user
    doctor = str(appointment.doctor)
    patient_name = patient.get_full_name() or patient.email
    when = timezone.localtime(appointment.start).strftime("%a %d %b, %I:%M %p")
    p_link, d_link, h_link = "/patient/appointments", "/doctor/appointments", "/admin/appointments"
    hospital = appointment.doctor.hospital
    hospital_name = hospital.name if hospital else "The hospital"
    # The hospital's managers, only for the events that go to them (one query, not on every event).
    hospital_admins = (
        [a.user for a in hospital.admins.select_related("user") if a.user.is_active]
        if hospital and event in HOSPITAL_EVENTS and (event != "doctor_accepted" or appointment.source == "hospital")
        else []
    )

    # event -> list of (user, title, message, link)
    messages = {
        "booked": [
            (patient, "Appointment booked", f"{doctor} · {when}", p_link),
            (doctor_user, "New booking", f"{patient_name} · {when}", d_link),
        ],
        "confirmed": [(patient, "Appointment confirmed", f"{doctor} confirmed your visit on {when}", p_link)],
        "cancelled": [
            (patient, "Appointment cancelled", f"{doctor} · {when}", p_link),
            (doctor_user, "Appointment cancelled", f"{patient_name} · {when}", d_link),
        ],
        # Hospital confirms first (owner request 2026-11-18)
        "requested": [
            (patient, "Booking received", f"{doctor} · {when}. Waiting for the hospital to confirm.", p_link),
            *[(a, "New booking to confirm", f"{patient_name} with {doctor} · {when}", h_link) for a in hospital_admins],
        ],
        "hospital_confirmed": [
            (patient, "Appointment confirmed", f"{hospital_name} confirmed your visit with {doctor} on {when}", p_link),
            (doctor_user, "New booking", f"{patient_name} · {when}", d_link),
        ],
        "hospital_declined": [
            (patient, "Appointment declined", f"{hospital_name} couldn't confirm {doctor} on {when}: {appointment.cancel_reason}", p_link),
        ],
        "request_cancelled": [
            (patient, "Appointment cancelled", f"{doctor} · {when}", p_link),
            *[(a, "Booking cancelled by the patient", f"{patient_name} with {doctor} · {when}", h_link) for a in hospital_admins],
        ],
        "reminder_24h": [(patient, "Appointment tomorrow", f"{doctor} · {when}", p_link)],
        "reminder_1h": [(patient, "Appointment in 1 hour", f"{doctor} · {when}", p_link)],
        # Patient queue (Step 3)
        "checked_in": [(doctor_user, "Patient checked in", f"{patient_name} · token {appointment.token}", "/doctor/queue")],
        "called_in": [(patient, "It's your turn", f"{doctor} is ready to see you now (token {appointment.token})", p_link)],
        # No-show (2026-11-20): marked by the doctor or hospital; in-app only
        "no_show": [(patient, "Missed appointment", f"You missed your visit with {doctor} on {when}. You can book a new one any time.", p_link)],
        "no_show_undone": [(patient, "Visit no longer marked as missed", f"Your visit with {doctor} on {when} counts as attended.", p_link)],
    }
    rejection = appointment.rejections.first() if event == "doctor_rejected" else None  # the newest one
    messages.update({
        # Booking flow (owner decisions 2026-11-21, appointments/flow.py)
        "doctor_requested": [
            (patient, "Booking received", f"{doctor} · {when}. Waiting for the doctor to accept.", p_link),
            (doctor_user, "New appointment request", f"{patient_name} · {when}. Accept or reject it.", d_link),
        ],
        "hospital_assigned": [
            (patient, "Hospital accepted your booking", f"{hospital_name} gave your visit on {when} to {doctor}. "
             "Waiting for the doctor to accept.", p_link),
            (doctor_user, "New appointment to accept", f"{patient_name} · {when}, from {hospital_name}. Accept or reject it.", d_link),
        ],
        "doctor_accepted": [
            (patient, "Appointment confirmed", f"{doctor} accepted your visit on {when}", p_link),
            *[(a, "Doctor accepted", f"{doctor} accepted {patient_name} · {when}", h_link) for a in hospital_admins],
        ],
        "doctor_rejected": [
            (a, "Doctor rejected an appointment",
             f"{doctor} can't take {patient_name} · {when}"
             f"{f': {rejection.reason}' if rejection else ''}. Assign another doctor or decline.", h_link)
            for a in hospital_admins
        ],
        "doctor_declined": [
            (patient, "Appointment declined", f"{doctor} couldn't take your visit on {when}: {appointment.cancel_reason}", p_link),
        ],
        "expired": [
            (patient, "Booking not confirmed", f"Your visit with {doctor} on {when} wasn't confirmed in time, so it was cancelled.", p_link),
        ],
    })
    items = messages.get(event, [])
    for user, title, message, link in items:
        create_notification(user, event, title, message, link, appointment)
    return len(items)
