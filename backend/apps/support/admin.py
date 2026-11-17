from django.contrib import admin

from apps.notifications.realtime import create_notification

from .models import SupportRequest


@admin.register(SupportRequest)
class SupportRequestAdmin(admin.ModelAdmin):
    """Where the platform admin answers support requests. Saving a new reply notifies the user."""

    list_display = ["id", "subject", "topic", "user", "status", "created_at"]
    list_filter = ["status", "topic"]
    search_fields = ["subject", "message", "user__email"]
    readonly_fields = ["user", "topic", "subject", "message", "created_at", "updated_at"]
    fields = ["user", "topic", "subject", "message", "status", "reply", "created_at", "updated_at"]

    def has_add_permission(self, request):
        return False  # requests come from users

    def save_model(self, request, obj, form, change):
        new_reply = "reply" in form.changed_data and obj.reply.strip()
        if new_reply and obj.status == SupportRequest.Status.OPEN:
            obj.status = SupportRequest.Status.ANSWERED
        super().save_model(request, obj, form, change)
        if new_reply:
            create_notification(obj.user, "support_reply", "Support replied",
                                f"{obj.subject}: {obj.reply[:200]}", link="/support")
