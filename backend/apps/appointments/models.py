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
    # Set by the reminder task so each reminder is sent only once.
    reminder_24h_sent_at = models.DateTimeField(null=True, blank=True)
    reminder_1h_sent_at = models.DateTimeField(null=True, blank=True)
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


class ExternalAppointment(models.Model):
    """
    An appointment the patient booked DIRECTLY with a hospital (its website or phone) and
    added to MediConnect themselves, so we can remind them. We can't verify it: it's always
    labelled "Booked directly with the hospital – added by you", and it never blocks any slot.
    """

    class Status(models.TextChoices):
        UPCOMING = "upcoming", "Upcoming"
        CANCELLED = "cancelled", "Cancelled"

    patient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="external_appointments")
    hospital = models.ForeignKey(
        "hospitals.Hospital", on_delete=models.SET_NULL, null=True, blank=True, related_name="external_appointments"
    )
    hospital_name = models.CharField(max_length=200, blank=True, help_text="Used when the hospital isn't in MediConnect")
    doctor_name = models.CharField(max_length=150, blank=True)
    start = models.DateTimeField()
    booking_reference = models.CharField(max_length=60, blank=True, help_text="Booking ID from the hospital, if any")
    notes = models.CharField(max_length=300, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.UPCOMING)
    reminder_24h_sent_at = models.DateTimeField(null=True, blank=True)
    reminder_1h_sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["start"]

    @property
    def display_hospital(self):
        return self.hospital.name if self.hospital else self.hospital_name

    def __str__(self):
        return f"External: {self.patient} at {self.display_hospital} {self.start:%Y-%m-%d %H:%M}"


class AppointmentRequest(models.Model):
    """
    A patient's request to visit a hospital that is NOT a MediConnect partner (scraped only).
    This is not an appointment: it never reserves a slot, and it is shown as
    "Pending – not confirmed" until an admin (later: the hospital) confirms it.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending – not confirmed"
        CONFIRMED = "confirmed", "Confirmed by hospital"
        DECLINED = "declined", "Declined"
        CANCELLED = "cancelled", "Cancelled by patient"

    patient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="appointment_requests")
    hospital = models.ForeignKey("hospitals.Hospital", on_delete=models.CASCADE, related_name="appointment_requests")
    scraped_doctor = models.ForeignKey(
        "scraper.ScrapedDoctor", on_delete=models.SET_NULL, null=True, blank=True, related_name="requests"
    )
    preferred_date = models.DateField()
    preferred_time = models.CharField(max_length=30, blank=True, help_text="e.g. 'Morning' or '10:30 AM'")
    reason = models.CharField(max_length=300, blank=True)
    phone = models.CharField(max_length=20, blank=True, help_text="So the hospital can call back")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    admin_note = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Request {self.id}: {self.patient} → {self.hospital} ({self.status})"
