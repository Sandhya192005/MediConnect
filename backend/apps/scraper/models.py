from django.conf import settings
from django.db import models
from django.db.models import Q

ACTIVE_JOB_STATUSES = ["pending", "running"]


class ScrapeJob(models.Model):
    """One run of the scraper for one hospital (or one search that may find a new hospital)."""

    class Status(models.TextChoices):
        PENDING = "pending", "Waiting"
        RUNNING = "running", "Collecting"
        DONE = "done", "Done"
        FAILED = "failed", "Failed"
        BLOCKED = "blocked", "Not allowed / not available"

    hospital = models.ForeignKey(
        "hospitals.Hospital", on_delete=models.CASCADE, null=True, blank=True, related_name="scrape_jobs"
    )
    query = models.CharField(max_length=200, blank=True, help_text="What the patient searched, e.g. 'Apollo Chennai'")
    query_key = models.CharField(max_length=200, blank=True, db_index=True)  # normalized query, for de-duplication
    url = models.URLField(blank=True, help_text="Website to read, if known")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    message = models.CharField(max_length=500, blank=True, help_text="Why it failed or was blocked")
    pages_visited = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            # Never two jobs at the same time for the same hospital.
            models.UniqueConstraint(
                fields=["hospital"], condition=Q(status__in=ACTIVE_JOB_STATUSES), name="one_active_scrape_per_hospital"
            ),
        ]

    def __str__(self):
        return f"Scrape {self.id} [{self.status}] {self.hospital or self.query or self.url}"


class ScrapedDoctor(models.Model):
    """
    A doctor listed on a hospital's own website. Information only: it has no MediConnect
    calendar, so it is NEVER bookable as a confirmed appointment (see AppointmentRequest).
    """

    hospital = models.ForeignKey("hospitals.Hospital", on_delete=models.CASCADE, related_name="scraped_doctors")
    name = models.CharField(max_length=150)
    specialization = models.CharField(max_length=150, blank=True)
    qualification = models.CharField(max_length=200, blank=True)
    timings = models.CharField(max_length=200, blank=True, help_text="As written on the website, e.g. 'Mon–Sat 9am–1pm'")
    source_url = models.URLField()
    collected_at = models.DateTimeField()

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["hospital", "name"], name="unique_scraped_doctor_per_hospital")]

    def __str__(self):
        return f"{self.name} ({self.hospital})"
