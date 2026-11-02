"""
MediConnect hospitals (partners) for the "Find hospitals or doctors" page.

A partner = an approved hospital with at least one active doctor who has working hours. Each result
lists the hospital's specialties and, when the patient searched something ("heart", "Dr. Rao",
"cardiolgist"), the doctors there who match. Elasticsearch finds the matches (typos, synonyms);
PostgreSQL decides what's actually bookable. If Elasticsearch is down, a plain database search is used.
"""

import logging
from collections import Counter, defaultdict

from django.db.models import Q
from elasticsearch import ApiError, ConnectionError as ESConnectionError

from apps.doctors.models import DoctorProfile

from .indexes import es, index_name
from .queries import doctor_text_query

log = logging.getLogger(__name__)
MAX_MATCHES = 300


def _bookable_doctors():
    return (
        DoctorProfile.objects.filter(is_active=True, hospital__is_approved=True, availability__isnull=False)
        .select_related("user", "hospital", "department")
        .distinct()
    )


def _es_matches(q: str) -> tuple[list[int], list[int]]:
    """(doctor ids best match first, partner hospital ids whose name/address matches)."""
    doctors = es().search(
        index=index_name("doctors"), size=MAX_MATCHES, source=["id"],
        query={"bool": {"must": [doctor_text_query(q)], "filter": [{"term": {"is_bookable": True}}]}},
    )
    hospitals = es().search(
        index=index_name("hospitals"), size=50, source=["id"],
        # Name and city only: the departments field would make "heart" match every hospital with Cardiology,
        # and a "name match" hides the matching specialists.
        query={"bool": {"must": [{"multi_match": {"query": q, "fields": ["name^3", "city"], "fuzziness": "AUTO:3,5"}}],
                        "filter": [{"term": {"is_partner": True}}]}},
    )
    return [h["_source"]["id"] for h in doctors["hits"]["hits"]], [h["_source"]["id"] for h in hospitals["hits"]["hits"]]


def _db_matches(q: str, doctors) -> tuple[list[int], list[int]]:
    """Fallback without Elasticsearch: simple 'contains' matching."""
    words = Q(user__first_name__icontains=q) | Q(user__last_name__icontains=q) | Q(specialization__icontains=q) \
        | Q(department__name__icontains=q)
    doctor_ids = list(doctors.filter(words).values_list("id", flat=True))
    hospital_ids = list(doctors.filter(Q(hospital__name__icontains=q) | Q(hospital__city__icontains=q))
                        .values_list("hospital_id", flat=True).distinct())
    return doctor_ids, hospital_ids


def _specialty(d: DoctorProfile) -> str:
    return d.department.name if d.department else (d.specialization or "General")


def partner_hospitals(q: str = "", department: str | None = None, city: str | None = None,
                      max_fee: float | None = None) -> dict:
    doctors = _bookable_doctors()
    if city:
        doctors = doctors.filter(hospital__city__iexact=city)
    if max_fee is not None:
        doctors = doctors.filter(fee__lte=max_fee)

    degraded = False
    doctor_rank, name_hits = {}, set()
    if q:
        try:
            doctor_ids, hospital_ids = _es_matches(q)
        except (ESConnectionError, ApiError) as e:
            log.warning("Partner search fell back to the database: %s", e)
            doctor_ids, hospital_ids = _db_matches(q, doctors)
            degraded = True
        doctor_rank = {pk: i for i, pk in enumerate(doctor_ids)}
        name_hits = set(hospital_ids)

    by_hospital = defaultdict(list)
    for d in doctors:
        by_hospital[d.hospital_id].append(d)

    results = []
    for hospital_id, docs in by_hospital.items():
        matching = sorted((d for d in docs if d.id in doctor_rank), key=lambda d: doctor_rank[d.id])
        if department:
            # A department filter means: hospitals that have this kind of specialist.
            pool = matching if (q and hospital_id not in name_hits) else docs
            matching = [d for d in pool if _specialty(d) == department]
            if not matching:
                continue
        elif q and not matching and hospital_id not in name_hits:
            continue
        elif hospital_id in name_hits:
            matching = []  # searched the hospital itself: its specialties say enough, no "matching doctors"
        h = docs[0].hospital
        specialties = Counter(_specialty(d) for d in docs)
        results.append({
            "id": h.id, "name": h.name, "address": h.address, "city": h.city,
            "location_verified": h.location_verified,
            "doctor_count": len(docs),
            "specialties": [{"name": n, "count": c} for n, c in sorted(specialties.items())],
            "matching_doctors": [
                {"id": d.id, "name": d.user.get_full_name() or d.user.email, "specialization": d.specialization,
                 "department": _specialty(d), "fee": float(d.fee)}
                for d in matching
            ],
            "name_match": hospital_id in name_hits,
            "_rank": min((doctor_rank[d.id] for d in matching if d.id in doctor_rank), default=MAX_MATCHES),
        })

    # Hospital name matches first ("apollo"), then the hospital with the best-matching specialist.
    results.sort(key=lambda r: (not r["name_match"], r["_rank"], r["name"]))
    for r in results:
        del r["_rank"]

    departments = Counter(s["name"] for r in results for s in r["specialties"])
    cities = Counter(r["city"] for r in results)
    return {
        "total": len(results),
        "degraded": degraded,
        "results": results,
        "facets": {
            "departments": [{"value": v, "count": c} for v, c in departments.most_common(20)],
            "cities": [{"value": v, "count": c} for v, c in cities.most_common(20)],
        },
    }
