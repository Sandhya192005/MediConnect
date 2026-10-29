from django.contrib import admin

from .models import Appointment


@admin.register(Appointment)
class AppointmentAdmin(admin.ModelAdmin):
    list_display = ["patient", "doctor", "start", "status"]
    list_filter = ["status", "doctor__hospital"]
    search_fields = ["patient__email", "doctor__user__email"]
    date_hierarchy = "start"
