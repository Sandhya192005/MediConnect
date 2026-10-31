from django.contrib import admin

from .models import Appointment, AppointmentRequest, ExternalAppointment


@admin.register(ExternalAppointment)
class ExternalAppointmentAdmin(admin.ModelAdmin):
    list_display = ["patient", "display_hospital", "doctor_name", "start", "status"]
    list_filter = ["status"]
    search_fields = ["patient__email", "hospital_name", "hospital__name"]


@admin.register(AppointmentRequest)
class AppointmentRequestAdmin(admin.ModelAdmin):
    list_display = ["patient", "hospital", "scraped_doctor", "preferred_date", "status", "created_at"]
    list_filter = ["status"]
    search_fields = ["patient__email", "hospital__name"]


@admin.register(Appointment)
class AppointmentAdmin(admin.ModelAdmin):
    list_display = ["patient", "doctor", "start", "status"]
    list_filter = ["status", "doctor__hospital"]
    search_fields = ["patient__email", "doctor__user__email"]
    date_hierarchy = "start"
