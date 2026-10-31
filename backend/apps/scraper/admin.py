from django.contrib import admin

from .models import ScrapedDoctor, ScrapeJob


@admin.register(ScrapeJob)
class ScrapeJobAdmin(admin.ModelAdmin):
    list_display = ["id", "hospital", "query", "status", "pages_visited", "requested_by", "created_at", "finished_at"]
    list_filter = ["status"]
    search_fields = ["query", "url", "hospital__name"]
    readonly_fields = [f.name for f in ScrapeJob._meta.fields]


@admin.register(ScrapedDoctor)
class ScrapedDoctorAdmin(admin.ModelAdmin):
    list_display = ["name", "specialization", "hospital", "collected_at"]
    search_fields = ["name", "specialization", "hospital__name"]
    list_filter = ["hospital"]
