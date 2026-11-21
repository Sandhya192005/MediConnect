from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import PatientProfile

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    # Patients only (null for doctors and admins): the ID they share with a doctor to open their records.
    patient_id = serializers.SerializerMethodField()
    # Hospital accounts: the hospital they manage ({id, name} or null), and whether they're a platform admin.
    admin_hospital = serializers.SerializerMethodField()
    is_platform_admin = serializers.BooleanField(source="is_superuser", read_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name", "phone", "role", "patient_id",
                  "admin_hospital", "is_platform_admin"]
        read_only_fields = ["id", "role"]

    def get_admin_hospital(self, user):
        from .permissions import admin_hospital

        hospital = admin_hospital(user)
        return {"id": hospital.id, "name": hospital.name} if hospital else None

    def get_patient_id(self, user):
        if user.role != User.Role.PATIENT:
            return None
        from .models import PatientProfile

        return PatientProfile.for_user(user).patient_id


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)
    # Admins are created with `createsuperuser`, never through public sign-up.
    role = serializers.ChoiceField(
        choices=[User.Role.PATIENT, User.Role.DOCTOR], default=User.Role.PATIENT
    )

    class Meta:
        model = User
        fields = ["id", "email", "password", "first_name", "last_name", "phone", "role"]

    def validate_password(self, value):
        validate_password(value)
        return value

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class HospitalRegisterSerializer(serializers.Serializer):
    """
    A hospital signs up to use MediConnect for managing its staff and records (owner request 2026-11-18).
    The hospital itself is the account (owner request 2026-11-19): it logs in with the HOSPITAL's email and
    password (role "hospital"), not a person's. Creates that login and a private hospital linked to it, with
    the same email. The hospital is NOT connected: patients can't see or book it until the platform admin
    approves a connection.
    """

    email = serializers.EmailField()  # the hospital's email: also its login
    password = serializers.CharField(write_only=True)
    hospital_name = serializers.CharField(max_length=200)
    hospital_city = serializers.CharField(max_length=100)
    hospital_phone = serializers.CharField(max_length=30, required=False, allow_blank=True)

    def validate_email(self, value):
        value = User.objects.normalize_email(value).lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_password(self, value):
        validate_password(value)
        return value

    def validate_hospital_name(self, value):
        value = " ".join(value.split())
        if len(value) < 3:
            raise serializers.ValidationError("Please enter the hospital's full name.")
        return value

    def create(self, data):
        from django.db import transaction

        from apps.hospitals.models import Hospital
        from apps.staff.models import HospitalAdmin

        with transaction.atomic():
            # The login's name is the hospital's name, so greetings and menus show "ABC Hospital".
            user = User.objects.create_user(
                email=data["email"], password=data["password"], role=User.Role.HOSPITAL,
                first_name=data["hospital_name"][:150], last_name="", phone=data.get("hospital_phone", "")[:20],
            )
            hospital = Hospital.objects.create(
                name=data["hospital_name"], city=" ".join(data["hospital_city"].split()).title(),
                phone=data.get("hospital_phone", ""), email=data["email"], source=Hospital.Source.ACCOUNT,
                is_approved=False,  # private until the platform admin connects it (the model's default is True)
                location=None, location_verified=False,  # no pin: we never invent coordinates
            )
            HospitalAdmin.objects.create(user=user, hospital=hospital)
        return user

    def to_representation(self, user):
        return {"id": user.id, "email": user.email, "role": user.role}


HEALTH_FIELDS = [
    "height_cm", "weight_kg", "blood_group", "allergies", "no_known_allergies", "conditions", "conditions_other",
    "no_conditions", "current_medicines", "no_current_medicines", "emergency_contact_name",
    "emergency_contact_relation", "emergency_contact_phone",
]


class PatientDetailsSerializer(serializers.ModelSerializer):
    """
    A patient's own details on Profile & settings: date of birth, gender and health details.
    Doctors and admins get the same data (read-only) when they open the patient's records.
    """

    age = serializers.IntegerField(read_only=True)
    bmi = serializers.FloatField(read_only=True)
    height_cm = serializers.IntegerField(required=False, allow_null=True, min_value=30, max_value=250)
    weight_kg = serializers.DecimalField(max_digits=4, decimal_places=1, required=False, allow_null=True,
                                         min_value=Decimal("1"), max_value=Decimal("300"), coerce_to_string=False)
    conditions = serializers.ListField(child=serializers.ChoiceField(choices=list(PatientProfile.CONDITIONS)),
                                       required=False, max_length=len(PatientProfile.CONDITIONS))
    completeness = serializers.SerializerMethodField()

    class Meta:
        model = PatientProfile
        fields = ["patient_id", "date_of_birth", "gender", "age", "bmi", *HEALTH_FIELDS,
                  "weight_updated_on", "health_updated_at", "completeness"]
        read_only_fields = ["patient_id", "weight_updated_on", "health_updated_at"]

    def get_completeness(self, p: PatientProfile) -> int:
        """Percent of the questions answered. "None" counts as an answer."""
        answered = [
            p.date_of_birth, p.gender, p.height_cm, p.weight_kg, p.blood_group,
            p.allergies or p.no_known_allergies,
            p.conditions or p.conditions_other or p.no_conditions,
            p.current_medicines or p.no_current_medicines,
            p.emergency_contact_name and p.emergency_contact_phone,
        ]
        return round(100 * sum(1 for a in answered if a) / len(answered))

    def validate_emergency_contact_phone(self, value):
        value = value.strip()
        digits = sum(c.isdigit() for c in value)
        if value and (not all(c.isdigit() or c in "+- ()" for c in value) or not 7 <= digits <= 15):
            raise serializers.ValidationError("Enter a phone number of 7 to 15 digits.")
        return value

    def validate(self, attrs):
        # Ticking "none" clears the list, so the two answers can't contradict each other.
        if attrs.get("no_known_allergies"):
            attrs["allergies"] = ""
        if attrs.get("no_conditions"):
            attrs["conditions"], attrs["conditions_other"] = [], ""
        if attrs.get("no_current_medicines"):
            attrs["current_medicines"] = ""
        if "conditions" in attrs:
            attrs["conditions"] = sorted(set(attrs["conditions"]))
        return attrs

    def update(self, instance, validated_data):
        from django.utils import timezone

        if "weight_kg" in validated_data and validated_data["weight_kg"] != instance.weight_kg:
            instance.weight_updated_on = timezone.localdate() if validated_data["weight_kg"] is not None else None
        if any(f in validated_data and validated_data[f] != getattr(instance, f) for f in HEALTH_FIELDS):
            instance.health_updated_at = timezone.now()
        return super().update(instance, validated_data)

    def validate_date_of_birth(self, value):
        from django.utils import timezone

        if value and value > timezone.localdate():
            raise serializers.ValidationError("The date of birth can't be in the future.")
        if value and value.year < timezone.localdate().year - 130:
            raise serializers.ValidationError("Please check the year.")
        return value


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Your current password isn't right.")
        return value

    def validate(self, attrs):
        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError({"new_password": "Choose a password different from your current one."})
        validate_password(attrs["new_password"], self.context["request"].user)
        return attrs


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True)


class TokenWithRoleSerializer(TokenObtainPairSerializer):
    """Adds role and name to the JWT and the login response."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["email"] = user.email
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data
