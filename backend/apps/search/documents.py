"""Turns database rows into Elasticsearch documents and keeps them in sync."""

from elasticsearch import NotFoundError
from elasticsearch.helpers import bulk

from apps.doctors.models import DoctorProfile
from apps.hospitals.models import Hospital

from .indexes import ensure_indexes, es, index_name


def _point(location):
    return {"lat": location.y, "lon": location.x} if location else None


def doctor_doc(d: DoctorProfile) -> dict:
    h = d.hospital
    return {
        "id": d.id,
        "name": d.user.get_full_name() or d.user.email,
        "specialization": d.specialization,
        "department": d.department.name if d.department else None,
        "department_id": d.department_id,
        "hospital_name": h.name if h else None,
        "hospital_id": d.hospital_id,
        "city": h.city if h else None,
        "qualification": d.qualification,
        "bio": d.bio,
        "fee": float(d.fee),
        "experience_years": d.experience_years,
        "location": _point(h.location) if h else None,
        "is_bookable": d.is_bookable,
    }


def hospital_doc(h: Hospital) -> dict:
    return {
        "id": h.id,
        "name": h.name,
        "address": h.address,
        "city": h.city,
        "state": h.state,
        "country": h.country,
        "departments": [d.name for d in h.departments.all()],
        "location": _point(h.location),
        "is_approved": h.is_approved,
    }


DOCTOR_QS = DoctorProfile.objects.select_related("user", "hospital", "department")
HOSPITAL_QS = Hospital.objects.prefetch_related("departments")


_indexes_ready = False


def _ensure_once() -> None:
    """Create indexes (with our analyzers) before the first write in this process.
    Otherwise Elasticsearch would auto-create them without synonyms/autocomplete."""
    global _indexes_ready
    if not _indexes_ready:
        ensure_indexes()
        _indexes_ready = True


def index_doctor(doctor_id: int) -> None:
    _ensure_once()
    d = DOCTOR_QS.filter(pk=doctor_id).first()
    if d is None:
        delete_doc("doctors", doctor_id)
    else:
        es().index(index=index_name("doctors"), id=d.id, document=doctor_doc(d))


def index_hospital(hospital_id: int) -> None:
    _ensure_once()
    h = HOSPITAL_QS.filter(pk=hospital_id).first()
    if h is None:
        delete_doc("hospitals", hospital_id)
    else:
        es().index(index=index_name("hospitals"), id=h.id, document=hospital_doc(h))


def delete_doc(kind: str, doc_id: int) -> None:
    try:
        es().delete(index=index_name(kind), id=doc_id)
    except NotFoundError:
        pass


def rebuild_all(refresh: bool = True) -> dict:
    """Delete and re-create both indexes, then bulk-load everything from PostgreSQL."""
    from .indexes import create_index

    for kind in ("doctors", "hospitals"):
        create_index(kind, delete_existing=True)
    n_docs, _ = bulk(
        es(),
        ({"_index": index_name("doctors"), "_id": d.id, "_source": doctor_doc(d)} for d in DOCTOR_QS.iterator()),
    )
    n_hosp, _ = bulk(
        es(),
        ({"_index": index_name("hospitals"), "_id": h.id, "_source": hospital_doc(h)} for h in HOSPITAL_QS),
    )
    if refresh:
        es().indices.refresh(index=f"{index_name('doctors')},{index_name('hospitals')}")
    return {"doctors": n_docs, "hospitals": n_hosp}


__all__ = ["ensure_indexes", "index_doctor", "index_hospital", "rebuild_all", "delete_doc"]
