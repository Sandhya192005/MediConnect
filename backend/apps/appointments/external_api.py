"""
"I booked this with the hospital" — appointments the patient made outside MediConnect
(on the hospital's own website or by phone) and added here only to get reminders.
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.hospitals.models import Hospital

from .models import ExternalAppointment


class ExternalAppointmentSerializer(serializers.ModelSerializer):
    hospital = serializers.PrimaryKeyRelatedField(queryset=Hospital.objects.all(), allow_null=True, required=False)
    display_hospital = serializers.CharField(read_only=True)
    label = serializers.SerializerMethodField()

    class Meta:
        model = ExternalAppointment
        fields = [
            "id", "hospital", "hospital_name", "display_hospital", "doctor_name", "start",
            "booking_reference", "notes", "status", "label", "created_at",
        ]
        read_only_fields = ["status"]

    def get_label(self, obj):
        return "Booked directly with the hospital – added by you"

    def validate_start(self, value):
        now = timezone.now()
        if value <= now:
            raise ValidationError("Add appointments that are still coming up.")
        if value > now + timedelta(days=365):
            raise ValidationError("Pick a time within the next year.")
        return value

    def validate(self, attrs):
        hospital = attrs.get("hospital", getattr(self.instance, "hospital", None))
        name = attrs.get("hospital_name", getattr(self.instance, "hospital_name", ""))
        if not hospital and not (name or "").strip():
            raise ValidationError({"hospital_name": "Choose the hospital or type its name."})
        return attrs


class ExternalAppointmentViewSet(viewsets.ModelViewSet):
    serializer_class = ExternalAppointmentSerializer
    http_method_names = ["get", "post", "patch", "delete"]

    def get_queryset(self):
        qs = ExternalAppointment.objects.filter(patient=self.request.user).select_related("hospital")  # own only
        when = self.request.query_params.get("when")
        now = timezone.now()
        if when == "upcoming":
            qs = qs.filter(start__gte=now, status=ExternalAppointment.Status.UPCOMING)
        elif when == "past":
            qs = qs.filter(start__lt=now).order_by("-start")
        return qs

    def perform_create(self, serializer):
        if self.request.user.role != "patient":
            raise PermissionDenied("Only patient accounts can add appointments.")
        serializer.save(patient=self.request.user)

    def perform_update(self, serializer):
        moved = "start" in serializer.validated_data and serializer.validated_data["start"] != serializer.instance.start
        extra = {"reminder_24h_sent_at": None, "reminder_1h_sent_at": None} if moved else {}
        serializer.save(**extra)  # new time -> reminders will be sent again for the new time

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        appt = self.get_object()
        appt.status = ExternalAppointment.Status.CANCELLED
        appt.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(appt).data)
