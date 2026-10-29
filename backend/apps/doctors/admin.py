from django.contrib import admin

from .models import DoctorProfile, WeeklyAvailability


class AvailabilityInline(admin.TabularInline):
    model = WeeklyAvailability
    extra = 0


@admin.register(DoctorProfile)
class DoctorProfileAdmin(admin.ModelAdmin):
    list_display = ["__str__", "specialization", "hospital", "department", "fee", "is_active"]
    list_filter = ["is_active", "department", "hospital__city"]
    search_fields = ["user__first_name", "user__last_name", "user__email", "specialization"]
    inlines = [AvailabilityInline]
