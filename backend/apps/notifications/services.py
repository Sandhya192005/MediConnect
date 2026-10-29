from django.db import transaction


def notify_appointment(appointment, event: str):
    """
    Queue notifications for an appointment event.
    on_commit waits until the database save is final, so the worker never
    looks for an appointment that isn't saved yet (or was rolled back).
    Phase 4 adds live in-app notifications here too.
    """
    from .tasks import send_appointment_email_task

    transaction.on_commit(lambda: send_appointment_email_task.delay(appointment.id, event))
