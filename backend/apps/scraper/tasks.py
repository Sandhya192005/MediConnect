from celery import shared_task

from .pipeline import run_job


# Runs on the "scraper" queue (scraper_worker container, one browser at a time).
# Hard time limit so a stuck website can never block the worker forever.
@shared_task(soft_time_limit=150, time_limit=180, acks_late=True)
def scrape_job_task(job_id: int):
    return run_job(job_id)
