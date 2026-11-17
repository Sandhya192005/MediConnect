from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import PatientProfile

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    # Patients only (null for doctors and admins): the ID they share with a doctor to open their records.
    patient_id = serializers.SerializerMethodField()
    # Admins: the hospital a hospital admin manages ({id, name} or null), and whether they're a platform admin.
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


class PatientDetailsSerializer(serializers.ModelSerializer):
    """A patient's own details on Profile & settings."""

    age = serializers.IntegerField(read_only=True)

    class Meta:
        model = PatientProfile
        fields = ["patient_id", "date_of_birth", "gender", "age"]
        read_only_fields = ["patient_id"]

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
