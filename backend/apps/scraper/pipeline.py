"""
One scrape job, start to finish (runs inside the scraper_worker container):

  find the hospital (OpenStreetMap) → check URL safety + robots.txt → Playwright reads pages
  → extract clean data (OpenAI or rules) → save to PostgreSQL with source URL + time → notify
"""

import logging

from django.contrib.gis.geos import Point
from django.db import transaction
from django.utils import timezone

from apps.hospitals.models import Hospital
from apps.notifications.realtime import create_notification

from . import browser, extract, geocode
from .models import ScrapedDoctor, ScrapeJob
from .safety import UnsafeURL, check_public_url

log = logging.getLogger(__name__)


class JobStop(Exception):
    """Ends a job with a clear status + message for the patient."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def _finish(job: ScrapeJob, status: str, message: str = ""):
    job.status, job.message, job.finished_at = status, message[:500], timezone.now()
    job.save(update_fields=["status", "message", "finished_at", "hospital", "pages_visited", "url"])
    if job.requested_by_id:
        hospital = job.hospital
        if status == ScrapeJob.Status.DONE:
            title, text = "Hospital info ready", f"{hospital.name}: collected from its website."
        else:
            title, text = "Couldn't collect hospital info", message or "Please try again later."
        create_notification(
            job.requested_by, f"scrape_{status}", title, text[:300],
            link=f"/hospitals/{hospital.id}" if hospital else "/hospitals/lookup",
        )


def _resolve_target(job: ScrapeJob) -> tuple[Hospital | None, str, dict | None]:
    """Work out which hospital and website this job is about."""
    hospital, url, place = job.hospital, job.url, None
    if hospital and not url:
        url = hospital.website
    if not url and job.query:
        place = geocode.find_hospital(job.query)
        if not place:
            raise JobStop(ScrapeJob.Status.FAILED, "We couldn't find that hospital on OpenStreetMap. Try adding the city.")
        url = place["website"]
        if not hospital:
            hospital = Hospital.objects.filter(name__iexact=place["name"], city__iexact=place["city"]).first()
    return hospital, url, place


def run_job(job_id: int) -> str:
    job = ScrapeJob.objects.select_related("hospital", "requested_by").get(pk=job_id)
    if job.status not in (ScrapeJob.Status.PENDING, ScrapeJob.Status.RUNNING):
        return job.status  # already handled (e.g. a retried task): do nothing again
    job.status, job.started_at = ScrapeJob.Status.RUNNING, timezone.now()
    job.save(update_fields=["status", "started_at"])

    try:
        hospital, url, place = _resolve_target(job)

        if not url:
            # Known place but no website: save what OpenStreetMap has, and say so honestly.
            hospital = _save(job, hospital, place, None, "", "")
            job.hospital = hospital
            raise JobStop(ScrapeJob.Status.BLOCKED, "This hospital has no website listed, so only its map details were saved.")

        try:
            url = check_public_url(url)
        except UnsafeURL as e:
            raise JobStop(ScrapeJob.Status.BLOCKED, str(e))
        job.url = url

        try:
            pages = browser.fetch_pages(url)
        except browser.RobotsBlocked as e:
            raise JobStop(ScrapeJob.Status.BLOCKED, str(e))
        job.pages_visited = len(pages)
        if not pages:
            raise JobStop(ScrapeJob.Status.FAILED, "The hospital's website didn't load. Please try again later.")

        data, method = extract.extract(pages, url)
        job.hospital = _save(job, hospital, place, data, url, pages[0]["url"])
        log.info("Scrape job %s done via %s: %s doctors", job.id, method, len(data["doctors"]))
        _finish(job, ScrapeJob.Status.DONE)
    except JobStop as stop:
        _finish(job, stop.status, stop.message)
    except Exception:
        log.exception("Scrape job %s crashed", job.id)
        _finish(job, ScrapeJob.Status.FAILED, "Something went wrong while reading the website.")
    return job.status


@transaction.atomic
def _save(job, hospital, place, data, site_url, source_url) -> Hospital:
    now = timezone.now()
    if hospital is None:
        name = (place or {}).get("name") or (data or {}).get("hospital_name") or job.query or site_url
        hospital = Hospital(
            name=name[:200],
            city=((place or {}).get("city") or "Unknown")[:100],
            source=Hospital.Source.SCRAPED,
            is_approved=False,  # visible for checking, but not a partner until an admin approves
        )
    if place:
        hospital.address = hospital.address or place["address"][:300]
        hospital.state = hospital.state or place["state"][:100]
        hospital.country = place["country"][:100] or hospital.country
        hospital.phone = hospital.phone or place["phone"][:30]
        if hospital.location is None:
            # Pin from OpenStreetMap: real data, but not verified by our admin.
            hospital.location = Point(place["lng"], place["lat"], srid=4326)
            hospital.location_verified = False
    if site_url:
        hospital.website = hospital.website or site_url
    if data is not None:
        hospital.source_url = source_url
        hospital.scraped_at = now
        hospital.booking_url = data["booking_url"]
        hospital.scraped_info = {k: data[k] for k in ("phones", "emails", "opd_timings", "departments", "notes", "address")}
        if not hospital.phone and data["phones"]:
            hospital.phone = data["phones"][0][:30]
    hospital.save()

    if data is not None:
        # Replace the scraped doctor list with what the website shows now.
        ScrapedDoctor.objects.filter(hospital=hospital).delete()
        ScrapedDoctor.objects.bulk_create([
            ScrapedDoctor(hospital=hospital, source_url=source_url, collected_at=now, **d) for d in data["doctors"]
        ])
    return hospital
