from rest_framework import serializers

from apps.doctors.models import DoctorProfile

from .models import Appointment


def hospital_place(h) -> dict | None:
    """
    Where a hospital is, for directions and a small map (owner request 2026-11-18): used by bookings,
    appointment requests and visits booked directly with a hospital. None if there's no hospital.
    """
    if h is None:
        return None
    return {
        "id": h.id, "address": h.address, "city": h.city, "phone": h.phone,
        "latitude": h.location.y if h.location else None,
        "longitude": h.location.x if h.location else None,
        "location_verified": h.location_verified,
    }


class AppointmentSerializer(serializers.ModelSerializer):
    doctor = serializers.PrimaryKeyRelatedField(queryset=DoctorProfile.objects.all())
    doctor_name = serializers.SerializerMethodField()
    specialization = serializers.CharField(source="doctor.specialization", read_only=True)
    hospital_name = serializers.CharField(source="doctor.hospital.name", read_only=True, default=None)
    # Where to go (owner request 2026-11-18): directions and a small map on the patient's appointments.
    hospital = serializers.SerializerMethodField()
    patient_name = serializers.SerializerMethodField()
    patient_email = serializers.EmailField(source="patient.email", read_only=True)
    # Patient queue (Step 3)
    queue_status = serializers.CharField(read_only=True)
    people_ahead = serializers.SerializerMethodField()
    patient_id = serializers.SerializerMethodField()
    # No-show (2026-11-20): whether this viewer may mark the visit missed, or undo that (rules in no_show.py).
    can_mark_no_show = serializers.SerializerMethodField()
    can_undo_no_show = serializers.SerializerMethodField()
    # Booking flow (2026-11-21): the newest doctor rejection, so the hospital sees who said no and why.
    last_rejection = serializers.SerializerMethodField()

    class Meta:
        model = Appointment
        fields = [
            "id", "doctor", "doctor_name", "specialization", "hospital_name", "hospital",
            "patient_name", "patient_email", "patient_id", "start", "end", "status", "reason",
            "cancelled_by", "cancel_reason", "awaiting_hospital", "created_at",
            "queue_status", "token", "checked_in_at", "consultation_started_at", "people_ahead",
            "no_show_by", "can_mark_no_show", "can_undo_no_show",
            "source", "awaiting_doctor", "last_rejection",
        ]
        read_only_fields = ["end", "status", "cancelled_by", "cancel_reason", "awaiting_hospital", "created_at", "token", "checked_in_at", "consultation_started_at", "no_show_by", "source", "awaiting_doctor"]
        # The view checks slot availability itself and returns a friendly message,
        # so skip DRF's auto-generated "unique set" validator.
        validators = []

    def get_hospital(self, obj):
        """The hospital's place: id, address, city, phone and its map pin (None if it has none yet)."""
        return hospital_place(obj.doctor.hospital)

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

    def _viewer(self):
        request = self.context.get("request")
        return request.user if request and request.user.is_authenticated else None

    def get_can_mark_no_show(self, obj):
        from .no_show import can_mark

        user = self._viewer()
        return bool(user) and can_mark(obj, user)

    def get_can_undo_no_show(self, obj):
        from .no_show import can_undo

        user = self._viewer()
        return bool(user) and can_undo(obj, user)

    def get_last_rejection(self, obj):
        rejections = list(obj.rejections.all())  # prefetched by the view, newest first
        if not rejections:
            return None
        r = rejections[0]
        return {"doctor_name": str(r.doctor), "reason": r.reason, "at": r.created_at}
