"""
Appointment REQUESTS. Kept apart from real bookings on purpose: a request never reserves a slot and is
always shown as "Pending – not confirmed" until someone confirms it. Two kinds:

  - website hospitals (not on MediConnect): the platform admin answers (`confirm/`, `decline/`);
  - a doctor a connected hospital added in Doctor management, who can't be booked online
    (owner request 2026-11-26, `staff_doctor`, `for_hospital=True`): that hospital answers.
    `hospital-confirm/` sets the doctor (the one asked for, or another, e.g. another neurologist),
    the date and the time; `hospital-decline/` needs a reason the patient can read.
"""

from datetime import datetime, timedelta

from django.utils import timezone
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts.permissions import admin_hospital, is_platform_admin
from apps.notifications.realtime import create_notification

from .models import ACTIVE_STATUSES, Appointment, AppointmentRequest

MIN_DECLINE_REASON = 5


def _staff_label(s) -> str:
    from apps.staff.listed import display_name, specialty

    return f"Dr. {display_name(s)} ({specialty(s)})"


class AppointmentRequestSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    hospital_name = serializers.CharField(source="hospital.name", read_only=True)
    hospital_phone = serializers.CharField(source="hospital.phone", read_only=True)
    doctor_name = serializers.SerializerMethodField()
    doctor_department = serializers.SerializerMethodField()
    assigned_doctor_name = serializers.SerializerMethodField()
    assigned_department = serializers.SerializerMethodField()
    reassigned = serializers.SerializerMethodField()
    patient_email = serializers.EmailField(source="patient.email", read_only=True)
    patient_name = serializers.SerializerMethodField()
    patient_id = serializers.SerializerMethodField()
    hospital_place = serializers.SerializerMethodField()  # directions and a small map

    class Meta:
        model = AppointmentRequest
        fields = [
            "id", "hospital", "hospital_name", "hospital_phone", "hospital_place", "scraped_doctor", "staff_doctor",
            "doctor_name", "doctor_department", "for_hospital", "assigned_doctor", "assigned_doctor_name",
            "assigned_department", "reassigned", "confirmed_date", "confirmed_time",
            "preferred_date", "preferred_time", "reason", "phone", "status", "status_label",
            "admin_note", "patient_email", "patient_name", "patient_id", "created_at",
        ]
        read_only_fields = ["status", "admin_note", "for_hospital", "assigned_doctor", "confirmed_date", "confirmed_time"]

    def get_hospital_place(self, obj):
        from .serializers import hospital_place

        return hospital_place(obj.hospital)

    def get_doctor_name(self, obj):
        from apps.staff.listed import display_name

        if obj.staff_doctor:
            return f"Dr. {display_name(obj.staff_doctor)}"
        return obj.scraped_doctor.name if obj.scraped_doctor else None

    def get_doctor_department(self, obj):
        from apps.staff.listed import specialty

        return specialty(obj.staff_doctor) if obj.staff_doctor else None

    def get_assigned_doctor_name(self, obj):
        from apps.staff.listed import display_name

        return f"Dr. {display_name(obj.assigned_doctor)}" if obj.assigned_doctor else None

    def get_assigned_department(self, obj):
        from apps.staff.listed import specialty

        return specialty(obj.assigned_doctor) if obj.assigned_doctor else None

    def get_reassigned(self, obj):
        return bool(obj.assigned_doctor_id and obj.staff_doctor_id and obj.assigned_doctor_id != obj.staff_doctor_id)

    def get_patient_name(self, obj):
        return obj.patient.get_full_name() or obj.patient.email

    def get_patient_id(self, obj):
        profile = getattr(obj.patient, "patient_profile", None)
        return getattr(profile, "patient_id", None)

    def validate_preferred_date(self, value):
        today = timezone.localdate()
        if value < today:
            raise ValidationError("Pick today or a future date.")
        if (value - today).days > 90:
            raise ValidationError("Pick a date within the next 90 days.")
        return value

    def validate(self, attrs):
        from apps.staff.listed import listed_doctors

        hospital, doctor, staff = attrs["hospital"], attrs.get("scraped_doctor"), attrs.get("staff_doctor")
        if doctor and staff:
            raise ValidationError("Pick one doctor.")
        if doctor and doctor.hospital_id != hospital.id:
            raise ValidationError({"scraped_doctor": "That doctor isn't listed at this hospital."})
        if staff and not listed_doctors().filter(pk=staff.pk, hospital=hospital).exists():
            # Only doctors patients can see: working at a connected hospital and not bookable online.
            raise ValidationError({"staff_doctor": "That doctor can't be requested at this hospital."})
        return attrs


def _notify_hospital(req, kind, title, message):
    for link in req.hospital.admins.select_related("user"):
        create_notification(link.user, kind, title, message[:300], link="/admin/appointments#requests")


class AppointmentRequestViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.RetrieveModelMixin,
                                viewsets.GenericViewSet):
    serializer_class = AppointmentRequestSerializer

    def get_queryset(self):
        qs = AppointmentRequest.objects.select_related(
            "hospital", "scraped_doctor", "patient", "staff_doctor__department", "assigned_doctor__department",
        )
        user = self.request.user
        status = self.request.query_params.get("status")
        if is_platform_admin(user):  # requests to non-partner hospitals: the platform answers them
            qs = qs.filter(for_hospital=False)
        elif user.role == "hospital":  # requests for the doctors it added itself
            hospital = admin_hospital(user)
            qs = qs.filter(hospital=hospital, for_hospital=True) if hospital else qs.none()
        else:
            return qs.filter(patient=user)  # patients only ever see their own
        return qs.filter(status=status) if status else qs

    def perform_create(self, serializer):
        user = self.request.user
        if user.role != "patient":
            raise PermissionDenied("Only patient accounts can send appointment requests.")
        d = serializer.validated_data
        duplicate = AppointmentRequest.objects.filter(
            patient=user, hospital=d["hospital"], scraped_doctor=d.get("scraped_doctor"),
            staff_doctor=d.get("staff_doctor"), preferred_date=d["preferred_date"], status="pending",
        ).exists()
        if duplicate:
            raise ValidationError("You already sent this request. We'll notify you when it's answered.")
        req = serializer.save(patient=user, for_hospital=bool(d.get("staff_doctor")))
        if req.for_hospital:
            who = user.get_full_name() or user.email
            _notify_hospital(req, "request_new", "New appointment request",
                             f"{who} · {_staff_label(req.staff_doctor)} · {req.preferred_date:%a %d %b}"
                             + (f", {req.preferred_time}" if req.preferred_time else ""))

    def _pending(self):
        req = self.get_object()
        if req.status != "pending":
            raise ValidationError({"status": f"Request is already {req.get_status_display().lower()}."})
        return req

    # --- Website hospitals: answered by the platform admin -------------------------------------------

    def _platform_answer(self, new_status):
        req = self._pending()  # first: others get "not found" for requests they can't see
        if not is_platform_admin(self.request.user):
            raise PermissionDenied("Only an admin can do this.")
        req.status, req.admin_note = new_status, str(self.request.data.get("note", ""))[:300]
        req.save(update_fields=["status", "admin_note", "updated_at"])
        title = "Appointment request confirmed" if new_status == "confirmed" else "Appointment request declined"
        msg = f"{req.hospital.name} · {req.preferred_date:%a %d %b}" + (f" · {req.admin_note}" if req.admin_note else "")
        create_notification(req.patient, f"request_{new_status}", title, msg[:300], link="/patient/appointments")
        return Response(self.get_serializer(req).data)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        return self._platform_answer("confirmed")

    @action(detail=True, methods=["post"])
    def decline(self, request, pk=None):
        return self._platform_answer("declined")

    # --- Hospital-added doctors: answered by the hospital ---------------------------------------------

    def _hospital_request(self):
        if self.request.user.role != "hospital":
            raise PermissionDenied("Only the hospital can answer this request.")
        return self._pending()  # get_queryset already limits a hospital to its own requests

    @action(detail=True, methods=["post"], url_path="hospital-confirm")
    def hospital_confirm(self, request, pk=None):
        """{doctor?: staff id (default: the doctor asked for), date?: YYYY-MM-DD (default: preferred), time: HH:MM, note?}"""
        from apps.staff.models import StaffMember

        req = self._hospital_request()
        try:
            day = datetime.strptime(str(request.data.get("date") or req.preferred_date), "%Y-%m-%d").date()
        except ValueError:
            raise ValidationError({"date": "Use a date like 2026-12-01."})
        try:
            at = datetime.strptime(str(request.data.get("time", "")), "%H:%M").time()
        except ValueError:
            raise ValidationError({"time": "Pick a time for the visit."})
        today = timezone.localdate()
        if day < today or (day - today).days > 90:
            raise ValidationError({"date": "Pick today or a date within the next 90 days."})
        start = timezone.make_aware(datetime.combine(day, at))
        if start <= timezone.now():
            raise ValidationError({"time": "That time has already passed."})

        doctor_id = request.data.get("doctor") or req.staff_doctor_id
        doctor = (StaffMember.objects.active(on=day).select_related("doctor", "department")
                  .filter(pk=doctor_id, hospital=req.hospital, kind=StaffMember.Kind.DOCTOR).first())
        if not doctor:
            raise ValidationError({"doctor": "Pick a doctor who works at your hospital on that day."})
        # Not a reserved slot, but don't confirm a doctor twice for the same time.
        taken = AppointmentRequest.objects.filter(assigned_doctor=doctor, status="confirmed", confirmed_date=day,
                                                  confirmed_time=at).exists()
        if doctor.doctor:  # a MediConnect doctor account: also check their online bookings
            end = start + timedelta(minutes=doctor.doctor.slot_minutes)
            taken = taken or Appointment.objects.filter(doctor=doctor.doctor, status__in=ACTIVE_STATUSES,
                                                        start__lt=end, end__gt=start).exists()
        if taken:
            raise ValidationError({"time": f"{_staff_label(doctor)} already has a visit at that time."})

        req.status, req.assigned_doctor, req.confirmed_date, req.confirmed_time = "confirmed", doctor, day, at
        req.admin_note = str(request.data.get("note", "")).strip()[:300]
        req.save(update_fields=["status", "assigned_doctor", "confirmed_date", "confirmed_time", "admin_note", "updated_at"])

        msg = f"{req.hospital.name} · {_staff_label(doctor)} · {day:%a %d %b} at {at:%I:%M %p}"
        if req.staff_doctor_id and doctor.id != req.staff_doctor_id:
            from apps.staff.listed import display_name

            msg += f" · Dr. {display_name(req.staff_doctor)} isn't available, so another doctor will see you"
        if req.admin_note:
            msg += f" · {req.admin_note}"
        create_notification(req.patient, "request_confirmed", "Appointment request confirmed", msg[:300],
                            link="/patient/appointments")
        return Response(self.get_serializer(req).data)

    @action(detail=True, methods=["post"], url_path="hospital-decline")
    def hospital_decline(self, request, pk=None):
        """{reason}: required, shown to the patient (e.g. "No neurologist is available that week")."""
        req = self._hospital_request()
        reason = str(request.data.get("reason", "")).strip()
        if len(reason) < MIN_DECLINE_REASON:
            raise ValidationError({"reason": "Tell the patient why (at least 5 characters)."})
        req.status, req.admin_note = "declined", reason[:300]
        req.save(update_fields=["status", "admin_note", "updated_at"])
        create_notification(req.patient, "request_declined", "Appointment request declined",
                            f"{req.hospital.name} · {self.get_serializer(req).data['doctor_name'] or 'any doctor'} · "
                            f"{req.preferred_date:%a %d %b} · Reason: {req.admin_note}"[:300],
                            link="/patient/appointments")
        return Response(self.get_serializer(req).data)

    # --- Patient ----------------------------------------------------------------------------------------

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        req = self._pending()
        if req.patient_id != request.user.id:
            raise PermissionDenied("Only the patient can cancel their request.")
        req.status = "cancelled"
        req.save(update_fields=["status", "updated_at"])
        if req.for_hospital:
            who = request.user.get_full_name() or request.user.email
            _notify_hospital(req, "request_cancelled", "Appointment request cancelled",
                             f"{who} cancelled the request for {req.preferred_date:%a %d %b}")
        return Response(self.get_serializer(req).data)
