from django.conf import settings
from django.db import models


class Notification(models.Model):
    """An in-app notification shown under the bell icon."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    kind = models.CharField(max_length=30)  # booked, confirmed, cancelled, reminder_24h, reminder_1h …
    title = models.CharField(max_length=120)
    message = models.CharField(max_length=300)
    link = models.CharField(max_length=200, blank=True)
    appointment = models.ForeignKey(
        "appointments.Appointment", on_delete=models.CASCADE, null=True, blank=True, related_name="notifications"
    )
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "is_read"])]

    def __str__(self):
        return f"{self.user}: {self.title}"
