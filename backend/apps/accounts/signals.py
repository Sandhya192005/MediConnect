from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import PatientProfile


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_patient_profile(sender, instance, created, **kwargs):
    """Every patient gets a patient ID as soon as the account exists."""
    if instance.role == "patient":
        PatientProfile.for_user(instance)
