import logging
import re

from elasticsearch import ApiError, ConnectionError as ESConnectionError
from rest_framework import permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from . import partners, queries

log = logging.getLogger(__name__)

UNAVAILABLE = Response(
    {"detail": "Search is temporarily unavailable.", "fallback": "/api/doctors/"}, status=503
)


def _num(value):
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def _page(request):
    try:
        return max(1, int(request.query_params.get("page", 1)))
    except ValueError:
        return 1


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def search(request):
    """
    GET /api/search/?q=heart&type=doctors|hospitals&department=&city=&min_fee=&max_fee=&page=
    If Elasticsearch is down, returns 503 so the frontend can fall back to the plain DB search.
    """
    p = request.query_params
    q = p.get("q", "").strip()[:100]
    try:
        if p.get("type") == "hospitals":
            data = queries.search_hospitals(q, city=p.get("city") or None, page=_page(request),
                                            size=20 if p.get("size") == "20" else 12, partners_only=p.get("partners") == "1",
                                            exclude_partners=p.get("partners") == "0")
        else:
            data = queries.search_doctors(
                q,
                department=p.get("department") or None,
                city=p.get("city") or None,
                min_fee=_num(p.get("min_fee")),
                max_fee=_num(p.get("max_fee")),
                page=_page(request),
            )
    except (ESConnectionError, ApiError) as e:
        log.warning("Search failed: %s", e)
        return UNAVAILABLE
    return Response(data)


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def partner_hospitals(request):
    """
    GET /api/search/partner-hospitals/?q=heart&department=&city=&max_fee=
    MediConnect hospitals (instant booking) with their specialties and the doctors matching q.
    Works without Elasticsearch too (plain database matching, "degraded": true).
    """
    p = request.query_params
    return Response(partners.partner_hospitals(
        p.get("q", "").strip()[:100],
        department=p.get("department") or None,
        city=p.get("city") or None,
        max_fee=_num(p.get("max_fee")),
    ))


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def listed_doctors(request):
    """
    GET /api/search/listed-doctors/?q=cardio&hospital=<id>
    Doctors found on hospitals' own websites (information only, not bookable on MediConnect).
    Plain PostgreSQL search with a typo-tolerant fallback (pg_trgm).
    """
    from django.contrib.postgres.search import TrigramWordSimilarity
    from django.db.models import Case, IntegerField, Q, When

    from apps.scraper.models import ScrapedDoctor

    from .specialties import matching_specialties, name_words

    q = request.query_params.get("q", "").strip()[:80]
    qs = ScrapedDoctor.objects.select_related("hospital")
    if h := request.query_params.get("hospital"):
        qs = qs.filter(hospital_id=h)
    if q:
        # Specialties are matched by word root and everyday words (specialties.py): letter-similarity on
        # specialties made "gynecologist" find cardiologists, since both end in "-ologist".
        # Specialty text only from the start of a word: "urologist" is hidden inside "Neurologist".
        literal = (Q(name__icontains=q) | Q(specialization__iregex=r"(^|[^a-z])" + re.escape(q))
                   | Q(hospital__name__icontains=q))
        specs = matching_specialties(q, qs.order_by().values_list("specialization", flat=True).distinct())
        found = qs.filter(literal | Q(specialization__in=specs)).annotate(
            literal_hit=Case(When(literal, then=0), default=1, output_field=IntegerField())
        ).order_by("literal_hit", "specialization", "name")
        # Nothing at all: maybe a typo in the doctor's NAME (names only, never specialty words).
        name_q = name_words(q)
        if found.exists():
            qs = found
        elif name_q:
            qs = qs.annotate(sim=TrigramWordSimilarity(name_q, "name")).filter(sim__gte=0.5).order_by("-sim")
        else:
            qs = qs.none()
    return Response({"results": [
        {"id": d.id, "name": d.name, "specialization": d.specialization, "qualification": d.qualification,
         "timings": d.timings, "hospital_id": d.hospital_id, "hospital_name": d.hospital.name,
         "hospital_city": d.hospital.city, "collected_at": d.collected_at, "source_url": d.source_url}
        for d in qs[:30]
    ]})


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def suggest(request):
    q = request.query_params.get("q", "").strip()[:50]
    if len(q) < 2:
        return Response({"doctors": [], "hospitals": []})
    try:
        return Response(queries.suggest(q))
    except (ESConnectionError, ApiError) as e:
        log.warning("Suggest failed: %s", e)
        return UNAVAILABLE
