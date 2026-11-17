from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class HospitalAdmin(models.Model):
    """
    Makes a user with role "admin" the administrator of ONE hospital. Created by a platform admin
    (Django superuser) in Django admin; there is no public sign-up for admins.
    """

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="hospital_admin")
    hospital = models.ForeignKey("hospitals.Hospital", on_delete=models.CASCADE, related_name="admins")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "admin_profile"
        verbose_name = "admin profile (hospital admin)"

    def __str__(self):
        return f"{self.user.email} → {self.hospital.name}"

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.user_id and self.user.role != "admin":
            raise ValidationError({"user": "Only accounts with the admin role can be hospital admins."})


class StaffQuerySet(models.QuerySet):
    def active(self, on=None):
        """Working at the hospital on a date (default today): joined by then and not yet left."""
        on = on or timezone.localdate()
        return self.filter(join_date__lte=on).filter(Q(left_on__isnull=True) | Q(left_on__gt=on))


class StaffMember(models.Model):
    """
    A doctor or nurse on a hospital's staff, with HR details only that hospital's admins can see.
    Nurses are records only (no login). A doctor's record can be linked to their MediConnect doctor account.
    """

    class Kind(models.TextChoices):
        DOCTOR = "doctor", "Doctor"
        NURSE = "nurse", "Nurse"

    hospital = models.ForeignKey("hospitals.Hospital", on_delete=models.CASCADE, related_name="staff")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    full_name = models.CharField(max_length=150)
    doctor = models.OneToOneField(
        "doctors.DoctorProfile", on_delete=models.SET_NULL, null=True, blank=True, related_name="staff_record",
        help_text="The doctor's MediConnect account, if they have one",
    )
    department = models.ForeignKey("hospitals.Department", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    designation = models.CharField(max_length=100, blank=True, help_text="e.g. Senior Consultant, Staff Nurse")
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    join_date = models.DateField()
    left_on = models.DateField(null=True, blank=True, help_text="Last day at the hospital, if they have left")
    monthly_salary = models.DecimalField(max_digits=10, decimal_places=2, help_text="In rupees")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = StaffQuerySet.as_manager()

    class Meta:
        db_table = "staff_member"
        ordering = ["full_name"]
        indexes = [models.Index(fields=["hospital", "kind"])]
        constraints = [
            models.CheckConstraint(condition=Q(monthly_salary__gte=0), name="staff_salary_not_negative"),
            models.CheckConstraint(condition=Q(doctor__isnull=True) | Q(kind="doctor"), name="staff_only_doctors_link_accounts"),
            models.CheckConstraint(condition=Q(left_on__isnull=True) | Q(left_on__gte=models.F("join_date")),
                                   name="staff_leaves_after_joining"),
        ]

    def __str__(self):
        return f"{self.full_name} ({self.get_kind_display()}, {self.hospital.name})"

    @property
    def is_active(self) -> bool:
        today = timezone.localdate()
        return self.join_date <= today and (self.left_on is None or self.left_on > today)
