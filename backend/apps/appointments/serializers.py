from rest_framework import serializers

from apps.doctors.models import DoctorProfile

from .models import Appointment


class AppointmentSerializer(serializers.ModelSerializer):
    doctor = serializers.PrimaryKeyRelatedField(queryset=DoctorProfile.objects.all())
    doctor_name = serializers.SerializerMethodField()
    specialization = serializers.CharField(source="doctor.specialization", read_only=True)
    hospital_name = serializers.CharField(source="doctor.hospital.name", read_only=True, default=None)
    patient_name = serializers.SerializerMethodField()
    patient_email = serializers.EmailField(source="patient.email", read_only=True)
    # Patient queue (Step 3)
    queue_status = serializers.CharField(read_only=True)
    people_ahead = serializers.SerializerMethodField()
    patient_id = serializers.SerializerMethodField()

    class Meta:
        model = Appointment
        fields = [
            "id", "doctor", "doctor_name", "specialization", "hospital_name",
            "patient_name", "patient_email", "patient_id", "start", "end", "status", "reason",
            "cancelled_by", "cancel_reason", "awaiting_hospital", "created_at",
            "queue_status", "token", "checked_in_at", "consultation_started_at", "people_ahead",
        ]
        read_only_fields = ["end", "status", "cancelled_by", "cancel_reason", "awaiting_hospital", "created_at", "token", "checked_in_at", "consultation_started_at"]
        # The view checks slot availability itself and returns a friendly message,
        # so skip DRF's auto-generated "unique set" validator.
        validators = []

    def get_doctor_name(self, obj):
        return str(obj.doctor)

    def get_patient_name(self, obj):
        return obj.patient.get_full_name() or obj.patient.email

    def get_people_ahead(self, obj):
        """Only for a waiting patient today; a count, never who the others are."""
        from .queue import people_ahead

        return people_ahead(obj)

    def get_patient_id(self, obj):
        """The patient's ID, so the doctor can open their records from the queue."""
        profile = getattr(obj.patient, "patient_profile", None)
        return profile.patient_id if profile else None
