"""
Appointment REQUESTS for scraped-only hospitals. Kept apart from real bookings on purpose:
a request never reserves a slot and is always shown as "Pending – not confirmed" until an
admin (later: the hospital itself) confirms it.
"""

from django.utils import timezone
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.notifications.realtime import create_notification

from .models import AppointmentRequest


class AppointmentRequestSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    hospital_name = serializers.CharField(source="hospital.name", read_only=True)
    hospital_phone = serializers.CharField(source="hospital.phone", read_only=True)
    doctor_name = serializers.CharField(source="scraped_doctor.name", read_only=True, default=None)
    patient_email = serializers.EmailField(source="patient.email", read_only=True)

    class Meta:
        model = AppointmentRequest
        fields = [
            "id", "hospital", "hospital_name", "hospital_phone", "scraped_doctor", "doctor_name",
            "preferred_date", "preferred_time", "reason", "phone", "status", "status_label",
            "admin_note", "patient_email", "created_at",
        ]
        read_only_fields = ["status", "admin_note"]

    def validate_preferred_date(self, value):
        today = timezone.localdate()
        if value < today:
            raise ValidationError("Pick today or a future date.")
        if (value - today).days > 90:
            raise ValidationError("Pick a date within the next 90 days.")
        return value

    def validate(self, attrs):
        hospital, doctor = attrs["hospital"], attrs.get("scraped_doctor")
        if doctor and doctor.hospital_id != hospital.id:
            raise ValidationError({"scraped_doctor": "That doctor isn't listed at this hospital."})
        return attrs


class AppointmentRequestViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.RetrieveModelMixin,
                                viewsets.GenericViewSet):
    serializer_class = AppointmentRequestSerializer

    def get_queryset(self):
        qs = AppointmentRequest.objects.select_related("hospital", "scraped_doctor", "patient")
        if self.request.user.role == "admin":
            return qs.filter(status=s) if (s := self.request.query_params.get("status")) else qs
        return qs.filter(patient=self.request.user)  # patients only ever see their own

    def perform_create(self, serializer):
        user = self.request.user
        if user.role != "patient":
            raise PermissionDenied("Only patient accounts can send appointment requests.")
        d = serializer.validated_data
        duplicate = AppointmentRequest.objects.filter(
            patient=user, hospital=d["hospital"], scraped_doctor=d.get("scraped_doctor"),
            preferred_date=d["preferred_date"], status="pending",
        ).exists()
        if duplicate:
            raise ValidationError("You already sent this request. We'll notify you when it's answered.")
        serializer.save(patient=user)

    def _set_status(self, new_status, *, admin_only):
        req = self.get_object()
        if admin_only and self.request.user.role != "admin":
            raise PermissionDenied("Only an admin can do this.")
        if req.status != "pending":
            raise ValidationError({"status": f"Request is already {req.get_status_display().lower()}."})
        req.status = new_status
        req.admin_note = str(self.request.data.get("note", ""))[:300] if admin_only else req.admin_note
        req.save(update_fields=["status", "admin_note", "updated_at"])
        if admin_only:
            title = "Appointment request confirmed" if new_status == "confirmed" else "Appointment request declined"
            msg = f"{req.hospital.name} · {req.preferred_date:%a %d %b}" + (f" · {req.admin_note}" if req.admin_note else "")
            create_notification(req.patient, f"request_{new_status}", title, msg[:300], link="/patient/appointments")
        return Response(self.get_serializer(req).data)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        return self._set_status("confirmed", admin_only=True)

    @action(detail=True, methods=["post"])
    def decline(self, request, pk=None):
        return self._set_status("declined", admin_only=True)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return self._set_status("cancelled", admin_only=False)
