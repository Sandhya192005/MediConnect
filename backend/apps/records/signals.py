from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import MedicalRecord


@receiver(post_delete, sender=MedicalRecord)
def delete_record_file(sender, instance, **kwargs):
    """
    Deleting a record (or the patient's whole account) also removes the file from disk,
    but only once the database change is committed, so a rolled-back delete keeps its file.
    """
    if instance.file:
        storage, name = instance.file.storage, instance.file.name
        transaction.on_commit(lambda: storage.delete(name))
