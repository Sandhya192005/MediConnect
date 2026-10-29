from django.conf import settings
from django.db import models
from django.db.models import Q

ACTIVE_STATUSES = ["booked", "confirmed"]


class AppointmentQuerySet(models.QuerySet):
    def active(self):
        return self.filter(status__in=ACTIVE_STATUSES)


class Appointment(models.Model):
    class Status(models.TextChoices):
        BOOKED = "booked", "Booked"
        CONFIRMED = "confirmed", "Confirmed"
        CANCELLED = "cancelled", "Cancelled"
        COMPLETED = "completed", "Completed"

    patient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="appointments")
    doctor = models.ForeignKey("doctors.DoctorProfile", on_delete=models.CASCADE, related_name="appointments")
    start = models.DateTimeField()
    end = models.DateTimeField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.BOOKED)
    reason = models.CharField(max_length=300, blank=True)
    cancelled_by = models.CharField(max_length=10, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = AppointmentQuerySet.as_manager()

    class Meta:
        ordering = ["start"]
        constraints = [
            # The database itself refuses two active bookings for the same doctor + time.
            models.UniqueConstraint(
                fields=["doctor", "start"],
                condition=Q(status__in=ACTIVE_STATUSES),
                name="unique_active_slot_per_doctor",
            )
        ]

    def __str__(self):
        return f"{self.patient} with {self.doctor} at {self.start:%Y-%m-%d %H:%M}"
