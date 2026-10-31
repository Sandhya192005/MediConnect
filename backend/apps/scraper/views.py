from django.db.models import Q
from rest_framework import permissions, serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response

from apps.hospitals.models import Hospital

from . import services
from .models import ScrapeJob
from .safety import UnsafeURL, check_public_url
from .serializers import HospitalWithScrapeSerializer, ScrapeJobSerializer


class LookupSerializer(serializers.Serializer):
    q = serializers.CharField(required=False, allow_blank=True, max_length=150)
    # Plain text here: check_public_url() below does the (stricter) validation.
    url = serializers.CharField(required=False, allow_blank=True, max_length=500)

    def validate(self, attrs):
        if not (attrs.get("q", "").strip() or attrs.get("url", "").strip()):
            raise serializers.ValidationError("Type a hospital name (with the city) or paste its website.")
        return attrs


def _visible_hospitals():
    # Approved hospitals plus scraped ones (shown for checking, clearly labelled as not partners).
    return Hospital.objects.filter(Q(is_approved=True) | Q(source=Hospital.Source.SCRAPED))


def _summary(h):
    return {
        "id": h.id, "name": h.name, "city": h.city, "source": h.source, "is_approved": h.is_approved,
        "scraped_at": h.scraped_at, "is_fresh": services.is_fresh(h), "website": h.website,
    }


@api_view(["POST"])
def lookup(request):
    """
    POST /api/scraper/lookup/ {q: "Apollo Hospital Chennai"} or {url: "https://…"}
    Returns matches from our database right away, plus a background job if fresh data is needed.
    """
    data = LookupSerializer(data=request.data)
    data.is_valid(raise_exception=True)
    q, url = data.validated_data.get("q", "").strip(), data.validated_data.get("url", "").strip()

    if url:
        try:
            url = check_public_url(url)
        except UnsafeURL as e:
            return Response({"url": [str(e)]}, status=400)

    matches = []
    if q:
        words = [w for w in services.normalize_query(q).split() if len(w) > 2][:5]
        qs = _visible_hospitals()
        for w in words:
            qs = qs.filter(Q(name__icontains=w) | Q(city__icontains=w))
        matches = list(qs[:10])
    elif url:
        host = url.split("//", 1)[-1].split("/", 1)[0].removeprefix("www.")
        matches = list(_visible_hospitals().filter(website__icontains=host)[:5])

    job, created = None, False
    try:
        target = matches[0] if len(matches) == 1 else None
        if target and services.needs_scrape(target):
            job, created = services.request_scrape(request.user, hospital=target)
        elif target is None and not matches:
            job, created = services.request_scrape(request.user, query=q, url=url)
    except services.TooManyJobs as e:
        return Response({"detail": str(e)}, status=429)

    return Response({
        "matches": [_summary(h) for h in matches],
        "job": ScrapeJobSerializer(job).data if job else None,
        "job_created": created,
    })


@api_view(["POST"])
def refresh(request, hospital_id):
    """POST /api/scraper/hospitals/<id>/refresh/ — "Refresh from website" button."""
    hospital = get_object_or_404(_visible_hospitals(), pk=hospital_id)
    if not hospital.website:
        return Response({"detail": "This hospital has no website to read."}, status=400)
    if not services.can_force_refresh(hospital):
        return Response({"detail": "This hospital was refreshed recently. Please try again later."}, status=429)
    try:
        job, created = services.request_scrape(request.user, hospital=hospital)
    except services.TooManyJobs as e:
        return Response({"detail": str(e)}, status=429)
    return Response({"job": ScrapeJobSerializer(job).data, "job_created": created},
                    status=status.HTTP_202_ACCEPTED if created else status.HTTP_200_OK)


@api_view(["GET"])
def job_detail(request, job_id):
    job = get_object_or_404(ScrapeJob, pk=job_id)
    if request.user.role != "admin" and job.requested_by_id != request.user.id:
        return Response(status=404)
    return Response(ScrapeJobSerializer(job).data)


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def hospital_detail(request, hospital_id):
    """Hospital page data, including scraped info. Scraped hospitals are viewable (for checking)."""
    hospital = get_object_or_404(_visible_hospitals().prefetch_related("departments", "scraped_doctors"), pk=hospital_id)
    return Response(HospitalWithScrapeSerializer(hospital).data)
