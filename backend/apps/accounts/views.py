from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import PatientProfile
from .permissions import IsPatient
from .throttles import ResetEmailThrottle
from .serializers import (
    ChangePasswordSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    PatientDetailsSerializer,
    RegisterSerializer,
    TokenWithRoleSerializer,
    UserSerializer,
)

User = get_user_model()


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    authentication_classes = []


class LoginView(TokenObtainPairView):
    serializer_class = TokenWithRoleSerializer


class MeView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/auth/me/ — your name and phone (email and role can't be changed here)."""

    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


class PatientDetailsView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/auth/me/patient/ — a patient's date of birth, gender and health details (and patient ID)."""

    serializer_class = PatientDetailsSerializer
    permission_classes = [IsPatient]
    http_method_names = ["get", "patch"]

    def get_object(self):
        return PatientProfile.for_user(self.request.user)


class ChangePasswordView(APIView):
    """POST /api/auth/change-password/ {current_password, new_password}"""

    def post(self, request):
        s = ChangePasswordSerializer(data=request.data, context={"request": request})
        s.is_valid(raise_exception=True)
        request.user.set_password(s.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        return Response({"detail": "Your password has been changed."})


RESET_SENT = "If an account exists for this email, we've sent a link to reset the password."
RESET_INVALID = "This reset link is invalid or has expired. Please ask for a new one."


class PasswordResetRequestView(APIView):
    """
    POST /api/auth/password-reset/ {email} — emails a one-time reset link.
    Always the same answer, so nobody can find out which emails have an account.
    Limits: 3 an hour per email address, 20 an hour per network address.
    """

    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle, ResetEmailThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        s = PasswordResetRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = User.objects.filter(email__iexact=s.validated_data["email"], is_active=True).first()
        if user:
            from .tasks import send_password_reset_email

            transaction.on_commit(lambda: send_password_reset_email.delay(user.id))
        return Response({"detail": RESET_SENT})


class PasswordResetConfirmView(APIView):
    """POST /api/auth/password-reset/confirm/ {uid, token, new_password} — sets the new password."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset_confirm"  # its own limit, so asking for a link doesn't use it up

    def post(self, request):
        s = PasswordResetConfirmSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            user = User.objects.get(pk=force_str(urlsafe_base64_decode(s.validated_data["uid"])), is_active=True)
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            user = None
        # The token is tied to the current password: once used (or after any password change) it stops working.
        if user is None or not default_token_generator.check_token(user, s.validated_data["token"]):
            return Response({"detail": RESET_INVALID}, status=400)
        try:
            validate_password(s.validated_data["new_password"], user)
        except DjangoValidationError as e:
            return Response({"new_password": list(e.messages)}, status=400)
        user.set_password(s.validated_data["new_password"])
        user.save(update_fields=["password"])
        return Response({"detail": "Your password has been reset. You can log in now."})
