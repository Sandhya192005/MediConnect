"""Account emails, sent by the Celery worker (so a slow mail server never slows a request)."""

from smtplib import SMTPException

from celery import shared_task
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode


@shared_task(autoretry_for=(SMTPException, OSError), retry_backoff=True, max_retries=5)
def send_password_reset_email(user_id: int) -> int:
    """The "Forgot password?" email with a one-time link (valid for PASSWORD_RESET_TIMEOUT)."""
    user = get_user_model().objects.filter(pk=user_id, is_active=True).first()
    if not user:
        return 0
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    link = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
    minutes = settings.PASSWORD_RESET_TIMEOUT // 60
    body = (
        f"Hello {user.first_name or user.email},\n\n"
        f"Someone asked to reset the password of your MediConnect account. To choose a new password, open:\n\n"
        f"{link}\n\n"
        f"The link works once and expires in {minutes} minutes.\n"
        f"If you didn't ask for this, ignore this email: your password stays the same.\n\n"
        f"MediConnect"
    )
    return send_mail("MediConnect – reset your password", body, settings.DEFAULT_FROM_EMAIL, [user.email])
