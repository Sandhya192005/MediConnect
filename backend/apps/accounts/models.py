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
        ADMIN = "admin", "Admin"

    username = None
    email = models.EmailField(unique=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.PATIENT)
    phone = models.CharField(max_length=20, blank=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    def __str__(self):
        return f"{self.email} ({self.role})"


def new_patient_code() -> str:
    """A random patient ID like "P483920". Random (not P1, P2, P3…) so IDs can't be guessed by counting."""
    return f"P{secrets.randbelow(900_000) + 100_000}"


class PatientProfile(models.Model):
    """Patient-only details. `patient_id` is the ID a patient shares with a doctor to open their records."""

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="patient_profile")
    patient_id = models.CharField(max_length=12, unique=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

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
