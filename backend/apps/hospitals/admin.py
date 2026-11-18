from django.contrib.gis import admin

from .models import ConnectionRequest, Department, Hospital


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    search_fields = ["name"]


@admin.register(Hospital)
class HospitalAdmin(admin.GISModelAdmin):
    list_display = ["name", "city", "country", "source", "is_approved", "location_verified"]
    list_filter = ["is_approved", "location_verified", "source", "website_source", "city"]
    search_fields = ["name", "city", "address"]
    filter_horizontal = ["departments"]
    actions = ["approve", "mark_location_verified"]

    @admin.action(description="Approve selected hospitals")
    def approve(self, request, queryset):
        from django.utils import timezone

        # A bulk update skips save(), so record the approval date here too (only for newly approved ones).
        queryset.filter(is_approved=False).update(is_approved=True, approved_at=timezone.now(), approved_at_estimated=False)

    @admin.action(description="Mark location as verified")
    def mark_location_verified(self, request, queryset):
        queryset.exclude(location=None).update(location_verified=True)


@admin.register(ConnectionRequest)
class ConnectionRequestAdmin(admin.ModelAdmin):
    """Read-mostly: approve or decline on the platform admin's Connection requests page, which also notifies."""

    list_display = ["hospital", "status", "requested_by", "created_at", "decided_at"]
    list_filter = ["status"]
    search_fields = ["hospital__name", "requested_by__email"]
    readonly_fields = ["hospital", "requested_by", "decided_by", "decided_at", "created_at"]
