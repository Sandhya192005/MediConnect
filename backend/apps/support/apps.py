from django.apps import AppConfig


class SupportConfig(AppConfig):
    """Need help? Contact support: messages from users, answered by the platform admin."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.support"
