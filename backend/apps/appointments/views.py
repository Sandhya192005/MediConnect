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

from . import flow, no_show
from . import queue as patient_queue
from .models import Appointment
from .serializers import AppointmentSerializer


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
        qs = (Appointment.objects.select_related("patient__patient_profile", "doctor__user", "doctor__hospital")
              .prefetch_related("rejections__doctor__user"))
        if user.role == "patient":
            qs = qs.filter(patient=user)
        elif user.role == "doctor":
            # A doctor sees a booking once it's given to them (a hospital request: after the hospital assigns it).
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
        elif p.get("awaiting") == "doctor":  # waiting for the doctor's Accept / Reject
            qs = qs.filter(awaiting_doctor=True, status=Appointment.Status.BOOKED)
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
                # Booking flow (flow.py): the slot is held now; the hospital or the doctor answers next.
                source = request.data.get("source")
                appointment = serializer.save(
                    patient=request.user, doctor=doctor, end=start + timedelta(minutes=doctor.slot_minutes),
                    source=source if source in Appointment.Source.values else Appointment.Source.PERSONAL,
                )
                flow.start(appointment)
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
        appointment.awaiting_doctor = False  # nothing left for the doctor to answer
        appointment.save(update_fields=["status", "cancelled_by", "awaiting_doctor", "updated_at"])  # awaiting_hospital kept (see model)
        invalidate_slots(appointment.doctor_id)
        notify_appointment(appointment, "request_cancelled" if was_awaiting else "cancelled")
        return Response(self.get_serializer(appointment).data)

    # ---- Booking flow (owner decisions 2026-11-21): see flow.py ----

    @action(detail=True, methods=["post"], url_path="hospital-confirm")
    def hospital_confirm(self, request, pk=None):
        """POST /api/appointments/<id>/hospital-confirm/ {doctor?} — the hospital accepts and assigns a doctor."""
        appointment = flow.hospital_assign(self.get_object(), request.user, request.data.get("doctor"))
        return Response(self.get_serializer(appointment).data)

    @action(detail=True, methods=["post"], url_path="hospital-decline")
    def hospital_decline(self, request, pk=None):
        """POST /api/appointments/<id>/hospital-decline/ {reason} — frees the slot; the patient sees why."""
        appointment = flow.hospital_decline(self.get_object(), request.user, request.data)
        return Response(self.get_serializer(appointment).data)

    @action(detail=True, methods=["get"], url_path="assignable-doctors")
    def assignable_doctors(self, request, pk=None):
        """GET /api/appointments/<id>/assignable-doctors/ — the hospital's doctors, free at that time or not."""
        appointment = self.get_object()
        if request.user.role != "hospital":
            raise PermissionDenied("Only the hospital's account assigns doctors.")
        return Response(flow.assignable_doctors(appointment))

    @action(detail=True, methods=["post"], url_path="doctor-accept")
    def doctor_accept(self, request, pk=None):
        """POST /api/appointments/<id>/doctor-accept/ — the doctor takes it: confirmed, the patient is told."""
        return Response(self.get_serializer(flow.doctor_accept(self.get_object(), request.user)).data)

    @action(detail=True, methods=["post"], url_path="doctor-reject")
    def doctor_reject(self, request, pk=None):
        """POST /api/appointments/<id>/doctor-reject/ {reason} — back to the hospital, or declined (personal)."""
        return Response(self.get_serializer(flow.doctor_reject(self.get_object(), request.user, request.data)).data)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        """The doctor's older "Confirm": for a request waiting for them it is Accept."""
        appointment = self.get_object()
        if appointment.awaiting_doctor:
            return Response(self.get_serializer(flow.doctor_accept(appointment, request.user)).data)
        appointment = self._doctor_set_status(Appointment.Status.CONFIRMED, allowed_from=("booked",))
        notify_appointment(appointment, "confirmed")
        return Response(self.get_serializer(appointment).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        if self.get_object().is_pending:
            raise ValidationError({"status": "This appointment hasn't been accepted yet."})
        appointment = self._doctor_set_status(Appointment.Status.COMPLETED, allowed_from=("booked", "confirmed"))
        return Response(self.get_serializer(appointment).data)

    # ---- No-show (owner request 2026-11-20): see no_show.py ----

    @action(detail=True, methods=["post"], url_path="no-show")
    def no_show(self, request, pk=None):
        """POST /api/appointments/<id>/no-show/ — the doctor or hospital: the patient didn't come."""
        appointment = no_show.mark_no_show(self.get_object(), request.user)
        return Response(self.get_serializer(appointment).data)

    @action(detail=True, methods=["post"], url_path="undo-no-show")
    def undo_no_show(self, request, pk=None):
        """POST /api/appointments/<id>/undo-no-show/ — a wrong click: the visit counts as completed again."""
        appointment = no_show.undo_no_show(self.get_object(), request.user)
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
        if self.request.user.role not in ("doctor", "hospital", "admin"):
            raise PermissionDenied("Only the doctor can do this.")
        appointment = self.get_object()
        if appointment.status not in allowed_from:
            raise ValidationError({"status": f"Appointment is {appointment.status}."})
        appointment.status = new_status
        appointment.save(update_fields=["status", "updated_at"])
        return appointment
