from rest_framework import serializers

from apps.hospitals.serializers import HospitalSerializer

from .models import ScrapedDoctor, ScrapeJob
from .services import is_fresh


class ScrapeJobSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = ScrapeJob
        fields = ["id", "hospital", "query", "url", "status", "status_label", "message", "pages_visited",
                  "created_at", "started_at", "finished_at"]


class ScrapedDoctorSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScrapedDoctor
        fields = ["id", "name", "specialization", "qualification", "timings", "source_url", "collected_at"]


class HospitalWithScrapeSerializer(HospitalSerializer):
    """Hospital + everything collected from its website, with where/when it came from."""

    scraped_doctors = ScrapedDoctorSerializer(many=True, read_only=True)
    is_fresh = serializers.SerializerMethodField()
    has_bookable_doctors = serializers.SerializerMethodField()
    active_job = serializers.SerializerMethodField()

    class Meta(HospitalSerializer.Meta):
        fields = HospitalSerializer.Meta.fields + [
            "source_url", "scraped_at", "booking_url", "scraped_info", "scraped_doctors",
            "is_fresh", "has_bookable_doctors", "active_job",
        ]

    def get_is_fresh(self, obj):
        return is_fresh(obj)

    def get_has_bookable_doctors(self, obj):
        # A "partner": approved, with at least one doctor who has a MediConnect calendar.
        return obj.is_approved and obj.doctors.filter(is_active=True, availability__isnull=False).exists()

    def get_active_job(self, obj):
        job = obj.scrape_jobs.filter(status__in=["pending", "running"]).first()
        return ScrapeJobSerializer(job).data if job else None
