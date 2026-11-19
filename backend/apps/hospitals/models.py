from django.contrib.gis.db import models


class Department(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Hospital(models.Model):
    class Source(models.TextChoices):
        MANUAL = "manual", "Added manually"
        SCRAPED = "scraped", "Scraped from web"
        OSM = "osm", "OpenStreetMap"
        # Created by a hospital's own sign-up (2026-11-18): a private workspace for managing staff and
        # records, never listed for patients until the platform admin connects (approves) it.
        ACCOUNT = "account", "Hospital sign-up"

    name = models.CharField(max_length=200)
    address = models.CharField(max_length=300, blank=True)
    city = models.CharField(max_length=100, db_index=True)
    state = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, default="India")
    phone = models.CharField(max_length=30, blank=True)
    # The hospital's email (2026-11-19). For a hospital account it is also the login email (kept the same as
    # users.email by the sign-up); for map-imported hospitals it is usually empty.
    email = models.EmailField(blank=True)
    website = models.URLField(blank=True)

    class WebsiteSource(models.TextChoices):
        OSM = "osm", "OpenStreetMap"
        WIKIDATA = "wikidata", "Wikidata"
        PATIENT = "patient", "Added by a patient"
        NEARBY = "nearby", "Same hospital nearby on the map"

    # Where the website came from ("" = added by an admin / the hospital itself).
    website_source = models.CharField(max_length=20, choices=WebsiteSource.choices, blank=True)
    # Last time we searched for a missing website, so we don't search again on every page view.
    website_checked_at = models.DateTimeField(null=True, blank=True)
    wikidata_id = models.CharField(max_length=20, blank=True, help_text="e.g. Q4780321, from OpenStreetMap")
    # (longitude, latitude) in WGS84 — used for "nearby hospitals" in Phase 6
    location = models.PointField(geography=True, srid=4326, null=True, blank=True)
    # Only an admin who has checked the address/pin sets this. Unverified locations are
    # still shown on the map, but labelled "approximate" — never presented as confirmed.
    location_verified = models.BooleanField(default=False)
    departments = models.ManyToManyField(Department, blank=True, related_name="hospitals")

    # Phase 7.5: hospitals fetched by the scraper need admin approval before booking.
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    # OpenStreetMap id, e.g. "way/123456". Lets us update the same hospital on the next map refresh.
    osm_id = models.CharField(max_length=40, unique=True, null=True, blank=True)
    is_approved = models.BooleanField(default=True)
    # Only used when the hospital has a hospital account: new bookings wait for the hospital's Confirm
    # before they reach the doctor (owner request 2026-11-18). The hospital can turn it off.
    confirm_bookings = models.BooleanField(default=True)

    # Filled by the scraper (Phase 7.5). Always shown with where/when it was collected.
    source_url = models.URLField(blank=True, help_text="Page the scraped information came from")
    scraped_at = models.DateTimeField(null=True, blank=True)
    booking_url = models.URLField(blank=True, help_text="The hospital's own online booking page, if it has one")
    scraped_info = models.JSONField(null=True, blank=True, help_text="Phones, emails, timings, notes from the website")
    created_at = models.DateTimeField(auto_now_add=True)
    # When the hospital was connected to MediConnect (approved), for the platform growth report.
    approved_at = models.DateTimeField(null=True, blank=True, db_index=True)
    approved_at_estimated = models.BooleanField(
        default=False, help_text="Approved before approval dates were recorded: approved_at is the date it was added"
    )

    class Meta:
        db_table = "hospital"  # renamed from hospitals_hospital (owner request 2026-11-19)
        ordering = ["name"]

    def __str__(self):
        return f"{self.name}, {self.city}"

    def save(self, *args, **kwargs):
        """Keep approved_at in step with is_approved (approving sets it once; un-approving clears it)."""
        from django.utils import timezone

        if self.is_approved and self.approved_at is None:
            self.approved_at, self.approved_at_estimated = timezone.now(), False
        elif not self.is_approved:
            self.approved_at, self.approved_at_estimated = None, False
        if kwargs.get("update_fields") is not None:
            kwargs["update_fields"] = {*kwargs["update_fields"], "approved_at", "approved_at_estimated"}
        super().save(*args, **kwargs)

    @property
    def is_partner(self) -> bool:
        """Instant booking possible: approved, with at least one MediConnect doctor who has working hours."""
        return self.is_approved and self.doctors.filter(is_active=True, availability__isnull=False).exists()

    @property
    def is_listed(self) -> bool:
        """Shown to patients at all: partners, plus hospitals from OpenStreetMap / their own websites."""
        return self.is_approved or self.source in (self.Source.OSM, self.Source.SCRAPED)


class ConnectionRequest(models.Model):
    """
    A signed-up hospital asks to be connected with MediConnect (owner request 2026-11-18, hospital sign-up
    phase 2). The platform admin approves (the hospital becomes visible and bookable for patients) or
    declines with a reason. A hospital has at most one pending request at a time.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Waiting for MediConnect"
        APPROVED = "approved", "Connected"
        DECLINED = "declined", "Declined"

    hospital = models.ForeignKey(Hospital, on_delete=models.CASCADE, related_name="connection_requests")
    requested_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, related_name="+")
    message = models.CharField(max_length=500, blank=True, help_text="From the hospital to MediConnect")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    admin_note = models.CharField(max_length=500, blank=True, help_text="MediConnect's answer (e.g. why declined)")
    decided_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "hospital_connection_request"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["hospital"], condition=models.Q(status="pending"),
                                    name="one_pending_connection_request_per_hospital"),
        ]

    def __str__(self):
        return f"{self.hospital} ({self.get_status_display()})"
