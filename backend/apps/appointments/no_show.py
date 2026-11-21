"""
No-show: the patient didn't come (owner decisions 2026-11-20).

- Marked BY HAND, by the patient's doctor or the hospital account. Never automatic: hospitals that don't
  use the check-in queue would otherwise see real visits counted as no-shows.
- Allowed once the visit time has started, for up to NO_SHOW_DAYS days, and only if nothing shows the
  patient came (not checked in, never called in, no treatment note). An appointment the hourly job has
  already auto-completed can still be marked: that job can't know whether the patient came.
- "Undo" turns a no-show back into a completed visit within the same window (for a wrong click).
- The patient gets an in-app notification (no email) either way.
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.notifications.services import notify_queue

from .models import Appointment

NO_SHOW_DAYS = 7
MARKABLE_FROM = (Appointment.Status.BOOKED, Appointment.Status.CONFIRMED, Appointment.Status.COMPLETED)
WHO_MAY_MARK = ("doctor", "hospital")


def _in_window(a: Appointment) -> bool:
    now = timezone.now()
    return now - timedelta(days=NO_SHOW_DAYS) <= a.start <= now


def _came(a: Appointment) -> bool:
    return bool(a.checked_in_at or a.consultation_started_at or getattr(a, "treatment_note", None))


def can_mark(a: Appointment, user) -> bool:
    return (user.role in WHO_MAY_MARK and a.status in MARKABLE_FROM and not a.is_pending
            and _in_window(a) and not _came(a))


def can_undo(a: Appointment, user) -> bool:
    return user.role in WHO_MAY_MARK and a.status == Appointment.Status.NO_SHOW and _in_window(a)


def mark_no_show(a: Appointment, user) -> Appointment:
    """The caller has already limited `a` to the user's own appointments (doctor) or hospital."""
    if user.role not in WHO_MAY_MARK:
        raise PermissionDenied("Only the doctor or the hospital can mark a missed visit.")
    if a.status == Appointment.Status.NO_SHOW:
        raise ValidationError({"status": "This visit is already marked as missed."})
    if a.status not in MARKABLE_FROM or a.is_pending:
        raise ValidationError({"status": f"A {a.status} appointment can't be marked as missed."})
    if a.start > timezone.now():
        raise ValidationError({"status": "You can mark a visit as missed once its time has come."})
    if not _in_window(a):
        raise ValidationError({"status": f"Visits can be marked as missed for up to {NO_SHOW_DAYS} days."})
    if _came(a):
        raise ValidationError({"status": "The patient checked in or has a treatment note for this visit, so they came."})
    a.status = Appointment.Status.NO_SHOW
    a.no_show_by = user.role
    a.save(update_fields=["status", "no_show_by", "updated_at"])
    notify_queue(a, "no_show")
    return a


def undo_no_show(a: Appointment, user) -> Appointment:
    if user.role not in WHO_MAY_MARK:
        raise PermissionDenied("Only the doctor or the hospital can change this.")
    if a.status != Appointment.Status.NO_SHOW:
        raise ValidationError({"status": "This visit isn't marked as missed."})
    if not _in_window(a):
        raise ValidationError({"status": f"A missed visit can be changed for up to {NO_SHOW_DAYS} days."})
    a.status = Appointment.Status.COMPLETED
    a.no_show_by = ""
    a.save(update_fields=["status", "no_show_by", "updated_at"])
    notify_queue(a, "no_show_undone")
    return a
