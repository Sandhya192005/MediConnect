from celery import shared_task
from elasticsearch import ConnectionError as ESConnectionError
from elasticsearch import TransportError

from . import documents

RETRY = {"autoretry_for": (ESConnectionError, TransportError), "retry_backoff": True, "max_retries": 8}


@shared_task(**RETRY)
def index_doctor_task(doctor_id: int):
    documents.index_doctor(doctor_id)


@shared_task(**RETRY)
def index_hospital_task(hospital_id: int, with_doctors: bool = True):
    """Re-index a hospital. Its name/city are copied into doctor docs too, so refresh those."""
    from apps.doctors.models import DoctorProfile

    documents.index_hospital(hospital_id)
    if with_doctors:
        for doctor_id in DoctorProfile.objects.filter(hospital_id=hospital_id).values_list("id", flat=True):
            documents.index_doctor(doctor_id)


@shared_task(**RETRY)
def delete_doc_task(kind: str, doc_id: int):
    documents.delete_doc(kind, doc_id)
