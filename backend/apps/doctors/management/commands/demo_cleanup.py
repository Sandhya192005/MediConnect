"""
Removes everything demo_setup created:

    docker compose exec backend python manage.py demo_cleanup

Deletes only demo.*@mediconnect.dev accounts (with everything they created: appointments, records,
notifications...) and the "MediConnect Demo Hospital" (with its staff records), then rebuilds the search
index and deletes backend/.demo-logins.json. Refuses to run unless DEBUG is on.
"""

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.hospitals.models import Hospital

from .demo_setup import DEMO_DOMAIN, DEMO_PREFIX, HOSPITAL_NAME, LOGINS_FILE

User = get_user_model()


class Command(BaseCommand):
    help = "Remove the demo accounts and the demo hospital created by demo_setup"

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("demo_cleanup only runs with DEBUG=1.")
        with transaction.atomic():
            users = User.objects.filter(email__startswith=DEMO_PREFIX, email__endswith=DEMO_DOMAIN)
            n_users = users.count()
            users.delete()
            n_hospitals, _ = Hospital.objects.filter(name=HOSPITAL_NAME).delete()
        LOGINS_FILE.unlink(missing_ok=True)
        self.stdout.write(f"Removed {n_users} demo accounts and the demo hospital ({'yes' if n_hospitals else 'not found'}).")
        try:
            from apps.search.documents import rebuild_all

            rebuild_all()
            self.stdout.write("Search index rebuilt.")
        except Exception as e:
            self.stderr.write(f"Search index not rebuilt: {e}")
