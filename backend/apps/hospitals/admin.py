from django.contrib.gis import admin

from .models import Department, Hospital


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    search_fields = ["name"]


@admin.register(Hospital)
class HospitalAdmin(admin.GISModelAdmin):
    list_display = ["name", "city", "country", "source", "is_approved", "location_verified"]
    list_filter = ["is_approved", "location_verified", "source", "city"]
    search_fields = ["name", "city", "address"]
    filter_horizontal = ["departments"]
    actions = ["approve", "mark_location_verified"]

    @admin.action(description="Approve selected hospitals")
    def approve(self, request, queryset):
        queryset.update(is_approved=True)

    @admin.action(description="Mark location as verified")
    def mark_location_verified(self, request, queryset):
        queryset.exclude(location=None).update(location_verified=True)
