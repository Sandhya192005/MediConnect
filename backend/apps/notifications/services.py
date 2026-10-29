from django.db import transaction


def notify_appointment(appointment, event: str):
    """
    Queue email + live in-app notifications for an appointment event.
    on_commit waits until the database save is final, so the worker never
    looks for an appointment that isn't saved yet (or was rolled back).
    """
    from .tasks import queue_appointment_notifications

    transaction.on_commit(lambda: queue_appointment_notifications(appointment.id, event))
