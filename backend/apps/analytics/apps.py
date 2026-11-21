from django.apps import AppConfig


class AnalyticsConfig(AppConfig):
    """Platform analytics for the platform admin: how many people use MediConnect and how it grows."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.analytics"
