from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.hospitals.models import Department, Hospital


class DoctorProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="doctor_profile")
    # Empty until the doctor fills in their profile.
    hospital = models.ForeignKey(Hospital, on_delete=models.SET_NULL, null=True, blank=True, related_name="doctors")
    department = models.ForeignKey(Department, on_delete=models.SET_NULL, null=True, blank=True, related_name="doctors")
    specialization = models.CharField(max_length=120, blank=True)
    qualification = models.CharField(max_length=200, blank=True)
    experience_years = models.PositiveSmallIntegerField(default=0)
    fee = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    bio = models.TextField(blank=True)
    slot_minutes = models.PositiveSmallIntegerField(default=15)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["user__first_name"]

    def __str__(self):
        return f"Dr. {self.user.get_full_name() or self.user.email}"

    @property
    def is_bookable(self):
        return bool(self.is_active and self.hospital_id and self.hospital.is_approved)


class WeeklyAvailability(models.Model):
    """A block of working hours on one weekday, e.g. Monday 09:00–13:00."""

    class Weekday(models.IntegerChoices):
        MON = 0, "Monday"
        TUE = 1, "Tuesday"
        WED = 2, "Wednesday"
        THU = 3, "Thursday"
        FRI = 4, "Friday"
        SAT = 5, "Saturday"
        SUN = 6, "Sunday"

    doctor = models.ForeignKey(DoctorProfile, on_delete=models.CASCADE, related_name="availability")
    weekday = models.PositiveSmallIntegerField(choices=Weekday.choices)
    start_time = models.TimeField()
    end_time = models.TimeField()

    class Meta:
        ordering = ["weekday", "start_time"]

    def clean(self):
        if self.start_time >= self.end_time:
            raise ValidationError("End time must be after start time.")

    def __str__(self):
        return f"{self.get_weekday_display()} {self.start_time:%H:%M}-{self.end_time:%H:%M}"
