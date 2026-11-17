from decimal import Decimal

from rest_framework import serializers

from apps.doctors.models import DoctorProfile

from .models import StaffMember

MAX_MONTHLY_SALARY = Decimal("10000000")  # ₹1 crore a month: anything above is surely a typo


class StaffMemberSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    is_active = serializers.BooleanField(read_only=True)
    doctor = serializers.PrimaryKeyRelatedField(queryset=DoctorProfile.objects.all(), required=False, allow_null=True)
    doctor_email = serializers.EmailField(source="doctor.user.email", read_only=True, default=None)
    full_name = serializers.CharField(max_length=150, required=False, allow_blank=True)

    class Meta:
        model = StaffMember
        fields = [
            "id", "kind", "full_name", "doctor", "doctor_email", "department", "department_name", "designation",
            "phone", "email", "join_date", "left_on", "monthly_salary", "is_active", "created_at",
        ]
        read_only_fields = ["created_at"]

    def validate_monthly_salary(self, value):
        if value < 0:
            raise serializers.ValidationError("Salary can't be negative.")
        if value > MAX_MONTHLY_SALARY:
            raise serializers.ValidationError("That salary looks too large. Enter the monthly amount in rupees.")
        return value

    def validate(self, attrs):
        hospital = self.context["hospital"]
        get = lambda key: attrs.get(key, getattr(self.instance, key, None))  # noqa: E731 (new value or current one)
        kind, doctor = get("kind"), get("doctor")

        if doctor is not None:
            if kind != StaffMember.Kind.DOCTOR:
                raise serializers.ValidationError({"doctor": "Only doctors can be linked to a doctor account."})
            if doctor.hospital_id != hospital.id:
                raise serializers.ValidationError({"doctor": "That doctor's MediConnect account isn't at your hospital."})
            taken = StaffMember.objects.filter(doctor=doctor).exclude(pk=getattr(self.instance, "pk", None))
            if taken.exists():
                raise serializers.ValidationError({"doctor": "This doctor already has a staff record."})

        name = (get("full_name") or "").strip()
        if not name and doctor is not None:
            name = doctor.user.get_full_name() or doctor.user.email  # take the name from the linked account
        if not name:
            raise serializers.ValidationError({"full_name": "Enter the staff member's name."})
        attrs["full_name"] = name

        join, left = get("join_date"), get("left_on")
        if join and left and left < join:
            raise serializers.ValidationError({"left_on": "The leaving date can't be before the joining date."})
        return attrs
