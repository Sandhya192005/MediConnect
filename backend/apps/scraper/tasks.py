import httpx
from celery import shared_task

from .pipeline import run_job


# Runs on the "scraper" queue (scraper_worker container, one browser at a time).
# Hard time limit so a stuck website can never block the worker forever.
@shared_task(soft_time_limit=150, time_limit=180, acks_late=True)
def scrape_job_task(job_id: int):
    return run_job(job_id)


# Map tiles from OpenStreetMap: plain HTTP, no browser, so they run on the normal worker.
# Overpass sometimes answers 429/504 when busy: retry with growing delays.
@shared_task(autoretry_for=(httpx.HTTPError,), retry_backoff=30, max_retries=4, soft_time_limit=170, time_limit=200)
def sync_osm_tile_task(key: str):
    from .directory import sync_tile

    return sync_tile(key)
