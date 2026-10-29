from rest_framework import serializers

from apps.hospitals.models import Department, Hospital

from .models import DoctorProfile, WeeklyAvailability


class AvailabilitySerializer(serializers.ModelSerializer):
    weekday_name = serializers.CharField(source="get_weekday_display", read_only=True)

    class Meta:
        model = WeeklyAvailability
        fields = ["id", "weekday", "weekday_name", "start_time", "end_time"]

    def validate(self, attrs):
        if attrs["start_time"] >= attrs["end_time"]:
            raise serializers.ValidationError("End time must be after start time.")
        return attrs


class DoctorSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    email = serializers.EmailField(source="user.email", read_only=True)
    hospital_name = serializers.CharField(source="hospital.name", read_only=True, default=None)
    hospital_city = serializers.CharField(source="hospital.city", read_only=True, default=None)
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    hospital = serializers.PrimaryKeyRelatedField(queryset=Hospital.objects.filter(is_approved=True), allow_null=True)
    department = serializers.PrimaryKeyRelatedField(queryset=Department.objects.all(), allow_null=True)
    availability = AvailabilitySerializer(many=True, read_only=True)

    class Meta:
        model = DoctorProfile
        fields = [
            "id", "name", "email", "hospital", "hospital_name", "hospital_city",
            "department", "department_name", "specialization", "qualification",
            "experience_years", "fee", "bio", "slot_minutes", "is_bookable", "availability",
        ]
        read_only_fields = ["is_bookable"]

    def get_name(self, obj):
        return obj.user.get_full_name() or obj.user.email
