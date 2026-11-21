"""
The booking flow (owner decisions 2026-11-21). How the patient booked decides who approves:

  HOSPITAL request (booked through the hospital's page, at a hospital with a hospital account):
      patient books ──► hospital: Accept & assign (to that doctor or another free doctor of theirs)
                     │              or Decline (reason → patient)
                     └► doctor: Accept → "confirmed"            (patient told)
                                Reject (reason) → back to the hospital, which reassigns or declines

  PERSONAL request (the patient found the doctor directly), or a hospital without a hospital account:
      patient books ──► doctor: Accept → "confirmed"  /  Reject (reason) → declined (patient told)

The slot is held from booking until it's declined or cancelled (status "booked"), so nobody can double
book it. Only an accepted appointment ("confirmed") gets reminders, the queue and treatment notes.
Every rejection is kept (DoctorRejection), so the hospital sees each doctor's rejections.
Requests nobody answered before the visit time are cancelled by the hourly job (expire_unanswered).
"""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.permissions import admin_hospital
from apps.doctors.models import DoctorProfile
from apps.doctors.services import invalidate_slots, is_slot_available
from apps.notifications.services import notify_appointment, notify_queue

from .models import ACTIVE_STATUSES, Appointment, DoctorRejection

Status = Appointment.Status


def hospital_has_account(hospital) -> bool:
    """Only a hospital with a hospital account can accept and assign; otherwise requests go to the doctor."""
    return bool(hospital and hospital.admins.exists())


def _reason(data) -> str:
    reason = " ".join(str(data.get("reason", "")).split())[:300]
    if not reason:
        raise ValidationError({"reason": "Please give a short reason; the patient or hospital sees it."})
    return reason


# ---------------------------------------------------------------- booking

def start(appointment: Appointment) -> None:
    """Right after a booking is saved: send it to the hospital or straight to the doctor."""
    to_hospital = (appointment.source == Appointment.Source.HOSPITAL
                   and hospital_has_account(appointment.doctor.hospital))
    appointment.awaiting_hospital, appointment.awaiting_doctor = to_hospital, not to_hospital
    appointment.save(update_fields=["awaiting_hospital", "awaiting_doctor", "updated_at"])
    notify_appointment(appointment, "requested" if to_hospital else "doctor_requested")


# ---------------------------------------------------------------- hospital

def _for_hospital(appointment: Appointment, user) -> Appointment:
    hospital = admin_hospital(user)
    if user.role != "hospital" or hospital is None:
        raise PermissionDenied("Only the hospital's account can do this.")
    if appointment.doctor.hospital_id != hospital.id:
        raise PermissionDenied("This booking is at another hospital.")
    if not (appointment.awaiting_hospital and appointment.status == Status.BOOKED):
        raise ValidationError({"status": "This booking isn't waiting for the hospital."})
    return appointment


def doctor_is_free(doctor: DoctorProfile, appointment: Appointment) -> bool:
    """Can this doctor take the appointment's time? Its own doctor always can (the slot is held for them)."""
    if doctor.id == appointment.doctor_id:
        return True
    if not doctor.is_bookable:
        return False
    if Appointment.objects.filter(doctor=doctor, status__in=ACTIVE_STATUSES,
                                  start__lt=appointment.end, end__gt=appointment.start).exists():
        return False
    return is_slot_available(doctor, appointment.start)


def assignable_doctors(appointment: Appointment) -> list[dict]:
    """The hospital's doctors for the Assign dropdown: free at that time or not, and who already said no."""
    rejected = set(appointment.rejections.values_list("doctor_id", flat=True))
    doctors = (DoctorProfile.objects.filter(hospital_id=appointment.doctor.hospital_id, is_active=True)
               .select_related("user", "department").order_by("user__first_name", "user__last_name"))
    return [{
        "id": d.id, "name": str(d), "specialization": d.specialization,
        "department": d.department.name if d.department else "",
        "chosen_by_patient": d.id == appointment.doctor_id and not appointment.rejections.exists(),
        "free": doctor_is_free(d, appointment), "rejected": d.id in rejected,
    } for d in doctors]


def hospital_assign(appointment: Appointment, user, doctor_id=None) -> Appointment:
    """Accept & assign: give the booking to a doctor (the patient's choice by default), who then answers."""
    _for_hospital(appointment, user)
    with transaction.atomic():
        target_id = int(doctor_id) if doctor_id else appointment.doctor_id
        # Lock both doctors' rows (in id order), so two assignments for one doctor run one after the other.
        locked = {d.id: d for d in DoctorProfile.objects.select_for_update()
                  .filter(id__in=sorted({appointment.doctor_id, target_id})).order_by("id")}
        target = locked.get(target_id)
        if target is None or target.hospital_id != appointment.doctor.hospital_id:
            raise ValidationError({"doctor": "Choose one of your hospital's doctors."})
        a = Appointment.objects.select_for_update().get(pk=appointment.pk)
        if not (a.awaiting_hospital and a.status == Status.BOOKED):
            raise ValidationError({"status": "This booking isn't waiting for the hospital."})
        if not doctor_is_free(target, a):
            raise ValidationError({"doctor": f"{target} isn't free at that time."})
        old_doctor = a.doctor_id
        a.doctor = target
        a.awaiting_hospital, a.awaiting_doctor = False, True
        a.save(update_fields=["doctor", "awaiting_hospital", "awaiting_doctor", "updated_at"])
        notify_appointment(a, "hospital_assigned")
    invalidate_slots(old_doctor)
    invalidate_slots(target.id)
    return a


def hospital_decline(appointment: Appointment, user, data) -> Appointment:
    """Decline (reason): frees the slot and tells the patient why. awaiting_hospital stays True (see model)."""
    reason = _reason(data)
    _for_hospital(appointment, user)
    appointment.status = Status.CANCELLED
    appointment.cancelled_by, appointment.cancel_reason = "hospital", reason
    appointment.save(update_fields=["status", "cancelled_by", "cancel_reason", "updated_at"])
    invalidate_slots(appointment.doctor_id)
    notify_appointment(appointment, "hospital_declined")
    return appointment


# ---------------------------------------------------------------- doctor

def _for_doctor(appointment: Appointment, user) -> Appointment:
    if user.role != "doctor" or appointment.doctor.user_id != user.id:
        raise PermissionDenied("Only the doctor it's given to can answer it.")
    if not (appointment.awaiting_doctor and appointment.status == Status.BOOKED):
        raise ValidationError({"status": "This appointment isn't waiting for your answer."})
    return appointment


def doctor_accept(appointment: Appointment, user) -> Appointment:
    _for_doctor(appointment, user)
    appointment.status, appointment.awaiting_doctor = Status.CONFIRMED, False
    appointment.save(update_fields=["status", "awaiting_doctor", "updated_at"])
    notify_appointment(appointment, "doctor_accepted")
    return appointment


def doctor_reject(appointment: Appointment, user, data) -> Appointment:
    """
    Reject (reason). A hospital request goes back to the hospital to reassign or decline; a personal request
    (or one at a hospital without an account) is declined and the patient is told why.
    """
    reason = _reason(data)
    _for_doctor(appointment, user)
    DoctorRejection.objects.create(appointment=appointment, doctor=appointment.doctor, reason=reason)
    appointment.awaiting_doctor = False
    if appointment.source == Appointment.Source.HOSPITAL and hospital_has_account(appointment.doctor.hospital):
        appointment.awaiting_hospital = True  # back to the hospital; the slot stays held meanwhile
        appointment.save(update_fields=["awaiting_doctor", "awaiting_hospital", "updated_at"])
        notify_queue(appointment, "doctor_rejected")  # in-app to the hospital only
    else:
        appointment.status = Status.CANCELLED
        appointment.cancelled_by, appointment.cancel_reason = "doctor", reason
        appointment.save(update_fields=["status", "awaiting_doctor", "cancelled_by", "cancel_reason", "updated_at"])
        invalidate_slots(appointment.doctor_id)
        notify_appointment(appointment, "doctor_declined")
    return appointment


# ---------------------------------------------------------------- nobody answered

EXPIRED_REASON = "Not confirmed before the appointment time"


def expire_unanswered() -> int:
    """Hourly: requests still waiting for the hospital or the doctor when their time has come are cancelled."""
    now = timezone.now()
    stale = Appointment.objects.filter(status=Status.BOOKED, start__lte=now).filter(
        awaiting_hospital=True) | Appointment.objects.filter(status=Status.BOOKED, start__lte=now, awaiting_doctor=True)
    n = 0
    for a in stale.select_related("doctor"):
        a.status, a.cancelled_by, a.cancel_reason = Status.CANCELLED, "system", EXPIRED_REASON
        a.awaiting_doctor = False
        a.save(update_fields=["status", "cancelled_by", "cancel_reason", "awaiting_doctor", "updated_at"])
        notify_appointment(a, "expired")
        n += 1
    return n
