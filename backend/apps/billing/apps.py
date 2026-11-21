from django.apps import AppConfig


class BillingConfig(AppConfig):
    """Payment slips a hospital gives its patients (owner request 2026-11-21)."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.billing"
