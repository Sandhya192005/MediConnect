from django.conf import settings
from django.db import models


class SupportRequest(models.Model):
    """A user's message to MediConnect support. The platform admin replies in Django admin."""

    class Status(models.TextChoices):
        # Only open and closed (owner decision 2026-11-25): a message gets one reply, so replying closes it.
        # The old "answered" status was turned into "closed" by migration 0002.
        OPEN = "open", "Open"
        CLOSED = "closed", "Closed"

    class Topic(models.TextChoices):
        ACCOUNT = "account", "My account / login"
        APPOINTMENT = "appointment", "Appointments"
        RECORDS = "records", "Medical records"
        HOSPITAL = "hospital", "Hospital information"
        OTHER = "other", "Something else"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="support_requests")
    topic = models.CharField(max_length=20, choices=Topic.choices, default=Topic.OTHER)
    subject = models.CharField(max_length=150)
    message = models.TextField(max_length=2000)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    reply = models.TextField(blank=True, help_text="Your answer: the user sees it in the app and gets a notification")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "support_request"
        ordering = ["-created_at"]

    def __str__(self):
        return f"#{self.pk} {self.subject} ({self.user.email})"
