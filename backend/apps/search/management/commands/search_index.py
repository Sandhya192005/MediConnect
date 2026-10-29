"""
python manage.py search_index          # create indexes if missing
python manage.py search_index --rebuild  # delete, re-create and fill from PostgreSQL
"""

from django.core.management.base import BaseCommand

from apps.search.documents import ensure_indexes, rebuild_all


class Command(BaseCommand):
    help = "Create or rebuild the Elasticsearch indexes"

    def add_arguments(self, parser):
        parser.add_argument("--rebuild", action="store_true", help="Delete and re-index everything")

    def handle(self, *args, rebuild=False, **options):
        if rebuild:
            counts = rebuild_all()
            self.stdout.write(self.style.SUCCESS(f"Indexed {counts['doctors']} doctors and {counts['hospitals']} hospitals."))
        else:
            ensure_indexes()
            self.stdout.write(self.style.SUCCESS("Indexes are ready."))
