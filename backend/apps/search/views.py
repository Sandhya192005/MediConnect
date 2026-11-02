import logging

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
            data = queries.search_hospitals(q, city=p.get("city") or None, page=_page(request))
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
    from django.db.models import Q

    from apps.scraper.models import ScrapedDoctor

    q = request.query_params.get("q", "").strip()[:80]
    qs = ScrapedDoctor.objects.select_related("hospital")
    if h := request.query_params.get("hospital"):
        qs = qs.filter(hospital_id=h)
    if q:
        exact = qs.filter(Q(name__icontains=q) | Q(specialization__icontains=q) | Q(hospital__name__icontains=q))
        qs = exact if exact.exists() else (
            qs.annotate(sim=TrigramWordSimilarity(q, "specialization") + TrigramWordSimilarity(q, "name"))
            .filter(sim__gte=0.35).order_by("-sim")
        )
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
