"""Treatment notes (reference design, Part 3; owner decision 2026-11-19: the patient + any doctor read them)."""

from django.utils import timezone
from rest_framework import serializers

from apps.appointments.models import Appointment

from .models import TreatmentNote

MAX_MEDICINES = 20


class MedicineSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    dose = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    frequency = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    days = serializers.IntegerField(min_value=1, max_value=365, required=False, allow_null=True, default=None)


class TreatmentNoteSerializer(serializers.ModelSerializer):
    medicines = MedicineSerializer(many=True, required=False)
    visit_start = serializers.DateTimeField(source="appointment.start", read_only=True)
    edited = serializers.SerializerMethodField()

    class Meta:
        model = TreatmentNote
        fields = ["id", "appointment", "visit_start", "doctor_name", "hospital_name", "diagnosis", "medicines",
                  "advice", "follow_up_on", "created_at", "updated_at", "edited"]
        read_only_fields = ["doctor_name", "hospital_name", "created_at", "updated_at"]
        # validate_appointment says "already has a note" in plain words (the database still enforces one per visit).
        extra_kwargs = {"appointment": {"validators": []}}

    def get_edited(self, note) -> bool:
        return (note.updated_at - note.created_at).total_seconds() > 60

    def validate_diagnosis(self, value):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("Write the diagnosis or the reason for the visit.")
        return value

    def validate_medicines(self, value):
        if len(value) > MAX_MEDICINES:
            raise serializers.ValidationError(f"At most {MAX_MEDICINES} medicines per note.")
        return value

    def validate_follow_up_on(self, value):
        if value and value < timezone.localdate():
            raise serializers.ValidationError("The follow-up date can't be in the past.")
        return value

    def validate_appointment(self, appt: Appointment):
        if self.instance is not None and appt != self.instance.appointment:
            raise serializers.ValidationError("A note stays with its visit.")
        user = self.context["request"].user
        if appt.doctor.user_id != user.id:
            raise serializers.ValidationError("You can only write notes for your own patients' visits.")
        if appt.status == Appointment.Status.CANCELLED or appt.is_pending:
            raise serializers.ValidationError("This visit was cancelled or isn't confirmed yet.")
        if timezone.localtime(appt.start).date() > timezone.localdate():
            raise serializers.ValidationError("You can write the note on the day of the visit or after it.")
        if self.instance is None and hasattr(appt, "treatment_note"):
            raise serializers.ValidationError("This visit already has a note: edit it instead.")
        return appt
