from django.db import migrations
from django.db.models import F


def backfill(apps, schema_editor):
    """Hospitals approved before approval dates were recorded: use the date they were added, marked as estimated."""
    Hospital = apps.get_model("hospitals", "Hospital")
    Hospital.objects.filter(is_approved=True, approved_at__isnull=True).update(
        approved_at=F("created_at"), approved_at_estimated=True
    )


class Migration(migrations.Migration):
    dependencies = [("hospitals", "0009_hospital_approved_at")]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
