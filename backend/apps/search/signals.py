"""
Keep Elasticsearch in sync: whenever a doctor/hospital/department/user changes in PostgreSQL,
queue a Celery task (after the DB transaction commits) to update the search copy.
"""

from django.conf import settings
from django.db import transaction
from django.db.models.signals import m2m_changed, post_delete, post_save
from django.dispatch import receiver

from apps.doctors.models import DoctorProfile
from apps.hospitals.models import Department, Hospital

from . import tasks


def _later(task, *args):
    transaction.on_commit(lambda: task.delay(*args))


@receiver(post_save, sender=DoctorProfile)
def doctor_saved(sender, instance, **kwargs):
    _later(tasks.index_doctor_task, instance.id)


@receiver(post_delete, sender=DoctorProfile)
def doctor_deleted(sender, instance, **kwargs):
    _later(tasks.delete_doc_task, "doctors", instance.id)


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def user_saved(sender, instance, **kwargs):
    # The doctor's name lives on the User model.
    profile_id = DoctorProfile.objects.filter(user=instance).values_list("id", flat=True).first()
    if profile_id:
        _later(tasks.index_doctor_task, profile_id)


@receiver(post_save, sender=Hospital)
def hospital_saved(sender, instance, **kwargs):
    _later(tasks.index_hospital_task, instance.id)


@receiver(post_delete, sender=Hospital)
def hospital_deleted(sender, instance, **kwargs):
    _later(tasks.delete_doc_task, "hospitals", instance.id)


@receiver(m2m_changed, sender=Hospital.departments.through)
def hospital_departments_changed(sender, instance, action, **kwargs):
    if action in ("post_add", "post_remove", "post_clear") and isinstance(instance, Hospital):
        _later(tasks.index_hospital_task, instance.id, False)


@receiver(post_save, sender=Department)
def department_saved(sender, instance, created, **kwargs):
    if created:
        return
    for doctor_id in DoctorProfile.objects.filter(department=instance).values_list("id", flat=True):
        _later(tasks.index_doctor_task, doctor_id)
    for hospital_id in instance.hospitals.values_list("id", flat=True):
        _later(tasks.index_hospital_task, hospital_id, False)
