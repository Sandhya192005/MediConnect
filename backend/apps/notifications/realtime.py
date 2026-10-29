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


def notify_appointment_in_app(appointment, event: str) -> int:
    patient = appointment.patient
    doctor_user = appointment.doctor.user
    doctor = str(appointment.doctor)
    patient_name = patient.get_full_name() or patient.email
    when = timezone.localtime(appointment.start).strftime("%a %d %b, %I:%M %p")
    p_link, d_link = "/patient/appointments", "/doctor/appointments"

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
        "reminder_24h": [(patient, "Appointment tomorrow", f"{doctor} · {when}", p_link)],
        "reminder_1h": [(patient, "Appointment in 1 hour", f"{doctor} · {when}", p_link)],
    }
    items = messages.get(event, [])
    for user, title, message, link in items:
        create_notification(user, event, title, message, link, appointment)
    return len(items)
