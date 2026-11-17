from django.contrib import admin

from .models import RecordAccess

# MedicalRecord is deliberately not registered: record files are private to the patient and permitted
# doctors, so they aren't browsable in Django admin. The access log is, for audits.


@admin.register(RecordAccess)
class RecordAccessAdmin(admin.ModelAdmin):
    list_display = ["created_at", "viewer_name", "hospital_name", "action", "record_title", "patient"]
    list_filter = ["action"]
    search_fields = ["viewer_name", "hospital_name", "patient__email"]
    readonly_fields = [f.name for f in RecordAccess._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
