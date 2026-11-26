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
        NO_SHOW = "no_show", "No-show"  # the patient didn't come, marked by hand (see no_show.py)

    patient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="appointments")
    doctor = models.ForeignKey("doctors.DoctorProfile", on_delete=models.CASCADE, related_name="appointments")
    start = models.DateTimeField()
    end = models.DateTimeField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.BOOKED)
    reason = models.CharField(max_length=300, blank=True)
    cancelled_by = models.CharField(max_length=10, blank=True)
    # Booking flow (owner decisions 2026-11-21, see flow.py). How the patient booked decides who approves:
    # - "hospital": booked through the hospital's page → the hospital accepts and assigns a doctor, then the
    #   doctor accepts or rejects (a rejection goes back to the hospital to reassign or decline);
    # - "personal": booked by finding the doctor directly → only the doctor accepts or rejects.
    # The slot is held the whole time (status "booked"); "confirmed" = the doctor accepted.
    class Source(models.TextChoices):
        PERSONAL = "personal", "Personal request (to the doctor)"
        HOSPITAL = "hospital", "Hospital request"

    source = models.CharField(max_length=10, choices=Source.choices, default=Source.PERSONAL)
    # Waiting for the hospital to accept and assign it. The doctor doesn't see it meanwhile. It stays True if
    # the booking is cancelled or declined before the hospital accepted: the doctor was never given it.
    awaiting_hospital = models.BooleanField(default=False, db_index=True)
    # Given to the doctor, waiting for their Accept / Reject.
    awaiting_doctor = models.BooleanField(default=False, db_index=True)
    cancel_reason = models.CharField(max_length=300, blank=True)
    no_show_by = models.CharField(max_length=10, blank=True, help_text="Who marked it missed: doctor or hospital")
    # Set by the reminder task so each reminder is sent only once.
    reminder_24h_sent_at = models.DateTimeField(null=True, blank=True)
    reminder_1h_sent_at = models.DateTimeField(null=True, blank=True)
    # Patient queue (Step 3), filled in on the day of the visit: see queue.py.
    checked_in_at = models.DateTimeField(null=True, blank=True)
    token = models.PositiveSmallIntegerField(null=True, blank=True, help_text="Queue number for the day, per doctor")
    consultation_started_at = models.DateTimeField(null=True, blank=True)
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
            ),
            # …and a second patient in consultation with the same doctor while one is still in.
            models.UniqueConstraint(
                fields=["doctor"],
                condition=Q(status__in=ACTIVE_STATUSES, consultation_started_at__isnull=False),
                name="one_consultation_at_a_time_per_doctor",
            ),
        ]

    def __str__(self):
        return f"{self.patient} with {self.doctor} at {self.start:%Y-%m-%d %H:%M}"

    @property
    def is_pending(self) -> bool:
        """Booked but not accepted yet (by the hospital and/or the doctor): no reminders, queue or notes."""
        return self.awaiting_hospital or self.awaiting_doctor

    @property
    def queue_status(self) -> str:
        """Where the visit is today: not_arrived → waiting → in_consultation → done (or cancelled)."""
        if self.status == self.Status.CANCELLED:
            return "cancelled"
        if self.status == self.Status.COMPLETED:
            return "done"
        if self.status == self.Status.NO_SHOW:
            return "no_show"
        if self.consultation_started_at:
            return "in_consultation"
        if self.checked_in_at:
            return "waiting"
        return "not_arrived"


class DoctorRejection(models.Model):
    """
    A doctor said no to an appointment (owner decision 2026-11-21). Kept even after the hospital gives the
    appointment to another doctor, so the hospital's Doctor management can list each doctor's rejections.
    """

    appointment = models.ForeignKey(Appointment, on_delete=models.CASCADE, related_name="rejections")
    doctor = models.ForeignKey("doctors.DoctorProfile", on_delete=models.CASCADE, related_name="rejections")
    reason = models.CharField(max_length=300)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "doctor_rejection"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.doctor} rejected appointment {self.appointment_id}"


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
    A patient's request to visit a hospital that is NOT a MediConnect partner (scraped only), or (since
    2026-11-26) to see a doctor a connected hospital added without online booking (`staff_doctor`).
    This is not an appointment: it never reserves a slot, and it is shown as
    "Pending – not confirmed" until the platform admin (website hospitals) or the hospital (its own
    doctors) confirms it.
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
    # A doctor a connected hospital added in Doctor management (no online booking; owner request 2026-11-26).
    # Such requests are answered by that hospital, not the platform: it confirms a date and time with this
    # doctor or another one (e.g. another neurologist), or declines with a reason.
    for_hospital = models.BooleanField(default=False, help_text="Answered by the hospital, not the platform admin")
    staff_doctor = models.ForeignKey(
        "staff.StaffMember", on_delete=models.SET_NULL, null=True, blank=True, related_name="requested_in",
        help_text="The hospital-added doctor the patient asked for",
    )
    assigned_doctor = models.ForeignKey(
        "staff.StaffMember", on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_requests",
        help_text="The doctor the hospital confirmed (may differ from the one asked for)",
    )
    confirmed_date = models.DateField(null=True, blank=True)
    confirmed_time = models.TimeField(null=True, blank=True)
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
