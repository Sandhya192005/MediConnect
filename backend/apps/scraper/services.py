"""
Deciding WHEN to scrape. Searches are served from the database; a background job is queued only if:
  - the hospital was never scraped, or its copy is older than SCRAPER_FRESH_HOURS, or
  - the patient presses "Refresh from website" (at most once per SCRAPER_MIN_REFRESH_MINUTES),
and never if a job for that hospital is already waiting or running.
"""

import re
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import ACTIVE_JOB_STATUSES, ScrapeJob


class TooManyJobs(Exception):
    pass


def normalize_query(q: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", re.sub(r"\s+", " ", q.lower())).strip()[:200]


def is_fresh(hospital) -> bool:
    return bool(hospital.scraped_at and timezone.now() - hospital.scraped_at < timedelta(hours=settings.SCRAPER_FRESH_HOURS))


def active_job_for(hospital=None, query_key=None):
    qs = ScrapeJob.objects.filter(status__in=ACTIVE_JOB_STATUSES)
    if hospital is not None:
        return qs.filter(hospital=hospital).first()
    return qs.filter(hospital=None, query_key=query_key).first()


def _check_user_quota(user):
    key = f"scrape:quota:{user.id}"
    if cache.add(key, 1, timeout=3600):
        return
    if cache.incr(key) > settings.SCRAPER_JOBS_PER_USER_PER_HOUR:
        raise TooManyJobs("You've requested a lot of hospital lookups. Please try again in an hour.")


def _queue(job: ScrapeJob):
    from .tasks import scrape_job_task

    transaction.on_commit(lambda: scrape_job_task.delay(job.id))
    return job


def request_scrape(user, *, hospital=None, query: str = "", url: str = "") -> tuple[ScrapeJob, bool]:
    """Return (job, created). Re-uses a waiting/running job instead of starting a duplicate."""
    key = normalize_query(query) if query else url.lower()[:200]
    existing = active_job_for(hospital=hospital, query_key=key) if (hospital or key) else None
    if existing:
        return existing, False
    _check_user_quota(user)
    try:
        with transaction.atomic():
            job = ScrapeJob.objects.create(hospital=hospital, query=query[:200], query_key=key, url=url, requested_by=user)
    except IntegrityError:  # another request created one a moment ago
        return active_job_for(hospital=hospital), False
    return _queue(job), True


def needs_scrape(hospital) -> bool:
    """Partner hospitals without a website are never scraped; others when stale."""
    return bool(hospital.website) and not is_fresh(hospital)


def can_force_refresh(hospital) -> bool:
    if not hospital.scraped_at:
        return True
    return timezone.now() - hospital.scraped_at >= timedelta(minutes=settings.SCRAPER_MIN_REFRESH_MINUTES)
