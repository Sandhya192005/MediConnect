import secrets

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import IntegrityError, models, transaction


class UserManager(BaseUserManager):
    """Users log in with email instead of a username."""

    use_in_migrations = True

    def _create_user(self, email, password, **extra):
        if not email:
            raise ValueError("Email is required")
        user = self.model(email=self.normalize_email(email), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("role", User.Role.ADMIN)
        return self._create_user(email, password, **extra)


class User(AbstractUser):
    class Role(models.TextChoices):
        PATIENT = "patient", "Patient"
        DOCTOR = "doctor", "Doctor"
        # A hospital's own account (owner request 2026-11-19): it logs in with the hospital's email, and
        # staff.HospitalAdmin (table hospital_profile) links it to its one hospital.
        HOSPITAL = "hospital", "Hospital"
        ADMIN = "admin", "Platform admin"  # with is_superuser: the platform owner

    username = None
    email = models.EmailField(unique=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.PATIENT)
    phone = models.CharField(max_length=20, blank=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    class Meta:
        db_table = "users"  # every login; `role` says which profile table holds the rest

    def __str__(self):
        return f"{self.email} ({self.role})"

    @property
    def has_real_email(self) -> bool:
        """False for a patient a hospital added without an email (see NO_EMAIL_DOMAIN): never email them."""
        return bool(self.email) and not self.email.endswith("@" + NO_EMAIL_DOMAIN)


# A patient a hospital adds without an email (owner decision 2026-11-21: email is optional) still needs a
# unique login email, so they get a hidden one on this reserved domain (".invalid" can never receive mail).
# They have no password either: hospitals and doctors open records by patient ID. If the hospital later
# adds a real email, the patient can claim the account with "Forgot password?".
NO_EMAIL_DOMAIN = "no-email.mediconnect.invalid"


def new_patient_code() -> str:
    """A random patient ID like "P483920". Random (not P1, P2, P3…) so IDs can't be guessed by counting."""
    return f"P{secrets.randbelow(900_000) + 100_000}"


class PatientProfile(models.Model):
    """Patient-only details. `patient_id` is the ID a patient shares with a doctor to open their records."""

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="patient_profile")
    class Gender(models.TextChoices):
        FEMALE = "female", "Female"
        MALE = "male", "Male"
        OTHER = "other", "Other"

    patient_id = models.CharField(max_length=12, unique=True, editable=False)
    # Optional details the patient fills in under Profile & settings (shown to doctors with their records).
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=10, choices=Gender.choices, blank=True, help_text="Empty = prefer not to say")

    # ---- Health details (owner request 2026-11-18). All optional; the patient fills them in. ----
    class BloodGroup(models.TextChoices):
        A_POS = "A+", "A+"
        A_NEG = "A-", "A−"
        B_POS = "B+", "B+"
        B_NEG = "B-", "B−"
        AB_POS = "AB+", "AB+"
        AB_NEG = "AB-", "AB−"
        O_POS = "O+", "O+"
        O_NEG = "O-", "O−"
        UNKNOWN = "unknown", "Don't know"

    CONDITIONS = {  # long-term conditions a patient can tick; anything else goes in conditions_other
        "diabetes": "Diabetes",
        "high_bp": "High blood pressure",
        "asthma": "Asthma",
        "thyroid": "Thyroid problem",
        "heart": "Heart disease",
        "kidney": "Kidney disease",
    }

    height_cm = models.PositiveSmallIntegerField(null=True, blank=True)
    weight_kg = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    weight_updated_on = models.DateField(null=True, blank=True)  # weight changes: doctors see how recent it is
    blood_group = models.CharField(max_length=8, choices=BloodGroup.choices, blank=True)
    # For allergies, conditions and medicines, "none" is an answer of its own: a doctor must be able to tell
    # "has no allergies" apart from "didn't fill it in".
    allergies = models.TextField(blank=True, max_length=1000)
    no_known_allergies = models.BooleanField(default=False)
    conditions = models.JSONField(default=list, blank=True)  # keys of CONDITIONS
    conditions_other = models.CharField(max_length=300, blank=True)
    no_conditions = models.BooleanField(default=False)
    current_medicines = models.TextField(blank=True, max_length=1000)
    no_current_medicines = models.BooleanField(default=False)
    emergency_contact_name = models.CharField(max_length=120, blank=True)
    emergency_contact_relation = models.CharField(max_length=60, blank=True)
    emergency_contact_phone = models.CharField(max_length=20, blank=True)
    health_updated_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "patient_profile"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(height_cm__isnull=True) | models.Q(height_cm__gte=30, height_cm__lte=250),
                name="patient_height_in_range",
            ),
            models.CheckConstraint(
                condition=models.Q(weight_kg__isnull=True) | models.Q(weight_kg__gte=1, weight_kg__lte=300),
                name="patient_weight_in_range",
            ),
        ]

    @property
    def bmi(self) -> float | None:
        """Body mass index = weight (kg) / height (m)², from the latest height and weight."""
        if not self.height_cm or not self.weight_kg:
            return None
        metres = self.height_cm / 100
        return round(float(self.weight_kg) / (metres * metres), 1)

    @property
    def age(self) -> int | None:
        if not self.date_of_birth:
            return None
        from django.utils import timezone

        today, dob = timezone.localdate(), self.date_of_birth
        return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))

    def __str__(self):
        return f"{self.patient_id} ({self.user.email})"

    @classmethod
    def for_user(cls, user: User) -> "PatientProfile":
        """The patient's profile, created with a fresh unique ID the first time it's needed."""
        existing = cls.objects.filter(user=user).first()
        if existing:
            return existing
        for _ in range(20):  # 900,000 possible IDs: a clash is rare, so a few retries are plenty
            try:
                with transaction.atomic():
                    return cls.objects.create(user=user, patient_id=new_patient_code())
            except IntegrityError:
                existing = cls.objects.filter(user=user).first()  # created meanwhile by another request
                if existing:
                    return existing
        raise RuntimeError("Could not generate a unique patient ID")
