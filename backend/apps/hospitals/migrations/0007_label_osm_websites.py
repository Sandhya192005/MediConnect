from django.db import migrations


def label_osm_websites(apps, schema_editor):
    """Websites saved by earlier map imports came from OpenStreetMap: say so."""
    Hospital = apps.get_model("hospitals", "Hospital")
    Hospital.objects.filter(source="osm", website_source="").exclude(website="").update(website_source="osm")


class Migration(migrations.Migration):
    dependencies = [("hospitals", "0006_hospital_website_source")]
    operations = [migrations.RunPython(label_osm_websites, migrations.RunPython.noop)]
