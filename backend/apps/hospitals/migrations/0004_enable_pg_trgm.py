from django.contrib.postgres.operations import TrigramExtension
from django.db import migrations


class Migration(migrations.Migration):
    """Turns on PostgreSQL's pg_trgm extension (fuzzy text matching), used by hospital lookup."""

    dependencies = [("hospitals", "0003_hospital_booking_url_hospital_scraped_at_and_more")]

    operations = [TrigramExtension()]
