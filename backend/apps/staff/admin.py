from django.contrib import admin

from .models import HospitalAdmin, StaffMember


@admin.register(HospitalAdmin)
class HospitalAdminAdmin(admin.ModelAdmin):
    """How a platform admin makes someone a hospital admin: pick a user with role "admin" and their hospital."""

    list_display = ["user", "hospital", "created_at"]
    search_fields = ["user__email", "hospital__name"]
    raw_id_fields = ["user", "hospital"]


@admin.register(StaffMember)
class StaffMemberAdmin(admin.ModelAdmin):
    list_display = ["full_name", "kind", "hospital", "department", "designation", "join_date", "left_on"]
    list_filter = ["kind", "hospital"]
    search_fields = ["full_name", "email", "hospital__name"]
    raw_id_fields = ["doctor"]
