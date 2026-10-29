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

    class Meta:
        model = Appointment
        fields = [
            "id", "doctor", "doctor_name", "specialization", "hospital_name",
            "patient_name", "patient_email", "start", "end", "status", "reason",
            "cancelled_by", "created_at",
        ]
        read_only_fields = ["end", "status", "cancelled_by", "created_at"]
        # The view checks slot availability itself and returns a friendly message,
        # so skip DRF's auto-generated "unique set" validator.
        validators = []

    def get_doctor_name(self, obj):
        return str(obj.doctor)

    def get_patient_name(self, obj):
        return obj.patient.get_full_name() or obj.patient.email
