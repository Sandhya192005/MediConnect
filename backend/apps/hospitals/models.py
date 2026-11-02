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

    name = models.CharField(max_length=200)
    address = models.CharField(max_length=300, blank=True)
    city = models.CharField(max_length=100, db_index=True)
    state = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, default="India")
    phone = models.CharField(max_length=30, blank=True)
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

    # Filled by the scraper (Phase 7.5). Always shown with where/when it was collected.
    source_url = models.URLField(blank=True, help_text="Page the scraped information came from")
    scraped_at = models.DateTimeField(null=True, blank=True)
    booking_url = models.URLField(blank=True, help_text="The hospital's own online booking page, if it has one")
    scraped_info = models.JSONField(null=True, blank=True, help_text="Phones, emails, timings, notes from the website")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name}, {self.city}"

    @property
    def is_partner(self) -> bool:
        """Instant booking possible: approved, with at least one MediConnect doctor who has working hours."""
        return self.is_approved and self.doctors.filter(is_active=True, availability__isnull=False).exists()

    @property
    def is_listed(self) -> bool:
        """Shown to patients at all: partners, plus hospitals from OpenStreetMap / their own websites."""
        return self.is_approved or self.source in (self.Source.OSM, self.Source.SCRAPED)
