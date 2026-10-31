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

    name = models.CharField(max_length=200)
    address = models.CharField(max_length=300, blank=True)
    city = models.CharField(max_length=100, db_index=True)
    state = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, default="India")
    phone = models.CharField(max_length=30, blank=True)
    website = models.URLField(blank=True)
    # (longitude, latitude) in WGS84 — used for "nearby hospitals" in Phase 6
    location = models.PointField(geography=True, srid=4326, null=True, blank=True)
    # Only an admin who has checked the address/pin sets this. Unverified locations are
    # still shown on the map, but labelled "approximate" — never presented as confirmed.
    location_verified = models.BooleanField(default=False)
    departments = models.ManyToManyField(Department, blank=True, related_name="hospitals")

    # Phase 7.5: hospitals fetched by the scraper need admin approval before booking.
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    is_approved = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name}, {self.city}"
