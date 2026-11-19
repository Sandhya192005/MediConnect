from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts.permissions import admin_hospital, is_platform_admin
from apps.doctors.models import DoctorProfile
from apps.doctors.services import invalidate_slots, is_slot_available
from apps.notifications.services import notify_appointment

from . import queue as patient_queue
from .models import Appointment
from .serializers import AppointmentSerializer


def needs_hospital_confirmation(hospital) -> bool:
    """A booking waits for the hospital if it has a hospital account and its "confirm bookings" switch is on."""
    return bool(hospital and hospital.confirm_bookings and hospital.admins.exists())


class AppointmentViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet
):
    """
    Patients see and book their own appointments, doctors see theirs, admins see all.
    Filters: ?when=upcoming|past, ?status=..., ?date=YYYY-MM-DD
    """

    serializer_class = AppointmentSerializer

    def get_queryset(self):
        user = self.request.user
        qs = Appointment.objects.select_related("patient__patient_profile", "doctor__user", "doctor__hospital", "treatment_note")
        if user.role == "patient":
            qs = qs.filter(patient=user)
        elif user.role == "doctor":
            # A doctor sees a booking only once it's confirmed by the hospital (if it has to be).
            qs = qs.filter(doctor__user=user, awaiting_hospital=False)
        elif not is_platform_admin(user):
            # A hospital admin sees their hospital's appointments; an admin without a hospital sees none.
            hospital = admin_hospital(user)
            qs = qs.filter(doctor__hospital=hospital) if hospital else qs.none()

        p = self.request.query_params
        now = timezone.now()
        if p.get("when") == "upcoming":
            qs = qs.filter(start__gte=now)
        elif p.get("when") == "past":
            qs = qs.filter(start__lt=now).order_by("-start")
        if s := p.get("status"):
            qs = qs.filter(status=s)
        if d := p.get("date"):
            qs = qs.filter(start__date=d)
        if p.get("awaiting") == "1":  # the hospital's "To confirm" list
            qs = qs.filter(awaiting_hospital=True, status=Appointment.Status.BOOKED)
        return qs

    def create(self, request, *args, **kwargs):
        if request.user.role != "patient":
            raise PermissionDenied("Only patients can book appointments.")
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        start = serializer.validated_data["start"]

        try:
            with transaction.atomic():
                # Lock the doctor's row so two bookings for them run one after the other.
                doctor = DoctorProfile.objects.select_for_update().get(pk=serializer.validated_data["doctor"].pk)
                if not doctor.is_bookable:
                    raise ValidationError({"doctor": "This doctor is not accepting bookings."})
                if not is_slot_available(doctor, start):
                    raise ValidationError({"start": "This slot is not available. Please pick another time."})
                # Hospital confirms first: the slot is held now, the doctor hears about it after Confirm.
                awaiting = needs_hospital_confirmation(doctor.hospital)
                appointment = serializer.save(
                    patient=request.user, doctor=doctor, end=start + timedelta(minutes=doctor.slot_minutes),
                    awaiting_hospital=awaiting,
                )
                notify_appointment(appointment, "requested" if awaiting else "booked")
        except IntegrityError:
            raise ValidationError({"start": "Someone just booked this slot. Please pick another time."})

        invalidate_slots(doctor.id)
        return Response(self.get_serializer(appointment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        appointment = self.get_object()
        if appointment.status not in ("booked", "confirmed"):
            raise ValidationError({"status": f"Appointment is already {appointment.status}."})
        was_awaiting = appointment.awaiting_hospital  # the doctor never saw it: tell the hospital instead
        appointment.status = Appointment.Status.CANCELLED
        appointment.cancelled_by = request.user.role
        appointment.save(update_fields=["status", "cancelled_by", "updated_at"])  # awaiting_hospital kept (see model)
        invalidate_slots(appointment.doctor_id)
        notify_appointment(appointment, "request_cancelled" if was_awaiting else "cancelled")
        return Response(self.get_serializer(appointment).data)

    # ---- Hospital confirms first (owner request 2026-11-18) ----

    @action(detail=True, methods=["post"], url_path="hospital-confirm")
    def hospital_confirm(self, request, pk=None):
        """POST /api/appointments/<id>/hospital-confirm/ — the hospital confirms; now the doctor is told."""
        appointment = self._awaiting_for_hospital_admin()
        appointment.awaiting_hospital = False
        appointment.status = Appointment.Status.CONFIRMED
        appointment.save(update_fields=["awaiting_hospital", "status", "updated_at"])
        notify_appointment(appointment, "hospital_confirmed")
        return Response(self.get_serializer(appointment).data)

    @action(detail=True, methods=["post"], url_path="hospital-decline")
    def hospital_decline(self, request, pk=None):
        """POST /api/appointments/<id>/hospital-decline/ {reason} — frees the slot; the patient sees why."""
        reason = " ".join(str(request.data.get("reason", "")).split())[:300]
        if not reason:
            raise ValidationError({"reason": "Tell the patient why, e.g. \"The doctor is on leave that day\"."})
        appointment = self._awaiting_for_hospital_admin()
        # awaiting_hospital stays True: the doctor was never given this booking, so it stays out of their list.
        appointment.status = Appointment.Status.CANCELLED
        appointment.cancelled_by, appointment.cancel_reason = "hospital", reason
        appointment.save(update_fields=["status", "cancelled_by", "cancel_reason", "updated_at"])
        invalidate_slots(appointment.doctor_id)
        notify_appointment(appointment, "hospital_declined")
        return Response(self.get_serializer(appointment).data)

    def _awaiting_for_hospital_admin(self) -> Appointment:
        if self.request.user.role != "admin" or admin_hospital(self.request.user) is None:
            raise PermissionDenied("Only the hospital's admins confirm its bookings.")
        appointment = self.get_object()  # get_queryset already limits this to the admin's own hospital
        if appointment.doctor.hospital_id != admin_hospital(self.request.user).id:
            raise PermissionDenied("This booking is at another hospital.")
        if not (appointment.awaiting_hospital and appointment.status == Appointment.Status.BOOKED):
            raise ValidationError({"status": "This booking isn't waiting for confirmation."})
        return appointment

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        appointment = self._doctor_set_status(Appointment.Status.CONFIRMED, allowed_from=("booked",))
        notify_appointment(appointment, "confirmed")
        return Response(self.get_serializer(appointment).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        appointment = self._doctor_set_status(Appointment.Status.COMPLETED, allowed_from=("booked", "confirmed"))
        return Response(self.get_serializer(appointment).data)

    # ---- Patient queue (Step 3): see queue.py ----

    @action(detail=True, methods=["post"], url_path="check-in")
    def check_in(self, request, pk=None):
        """POST /api/appointments/<id>/check-in/ — the patient ("I've arrived") or their doctor."""
        if request.user.role not in ("patient", "doctor"):
            raise PermissionDenied("Only the patient or their doctor can check in.")
        appointment = patient_queue.check_in(self.get_object(), by=request.user.role)
        return Response(self.get_serializer(appointment).data)

    @action(detail=True, methods=["post"], url_path="call-in")
    def call_in(self, request, pk=None):
        """POST /api/appointments/<id>/call-in/ — the doctor calls a waiting patient in."""
        if request.user.role != "doctor":
            raise PermissionDenied("Only the doctor can call a patient in.")
        appointment = patient_queue.call_in(self.get_object())
        return Response(self.get_serializer(appointment).data)

    @action(detail=False, methods=["get"], url_path="queue")
    def queue(self, request):
        """
        GET /api/appointments/queue/ — the doctor's queue today:
        {date, in_consultation, waiting (by token), not_arrived (by time), done}
        """
        if request.user.role != "doctor":
            raise PermissionDenied("Only doctors have a queue.")
        doctor = DoctorProfile.objects.filter(user=request.user).first()
        groups = patient_queue.queue_for(doctor.id) if doctor else {k: [] for k in ("in_consultation", "waiting", "not_arrived", "done")}
        data = {k: self.get_serializer(v, many=True).data for k, v in groups.items()}
        return Response({"date": timezone.localdate().isoformat(), **data})

    def _doctor_set_status(self, new_status, allowed_from):
        if self.request.user.role not in ("doctor", "admin"):
            raise PermissionDenied("Only the doctor can do this.")
        appointment = self.get_object()
        if appointment.status not in allowed_from:
            raise ValidationError({"status": f"Appointment is {appointment.status}."})
        appointment.status = new_status
        appointment.save(update_fields=["status", "updated_at"])
        return appointment
