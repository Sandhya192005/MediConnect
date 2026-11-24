"""
Removes the data the Playwright end-to-end tests create (the opposite of e2e_setup):

    docker compose exec backend python manage.py e2e_cleanup

Deletes only e2e.*@mediconnect.dev accounts (with everything they created) and the "E2E …" test
hospitals, then refreshes the search index. Refuses to run unless DEBUG is on.
"""

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from apps.hospitals.models import Department, Hospital
from apps.notifications.models import Notification

User = get_user_model()


class Command(BaseCommand):
    help = "Remove the accounts and hospitals created by the end-to-end tests"

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("e2e_cleanup only runs with DEBUG=1.")
        with transaction.atomic():
            users = User.objects.filter(
                Q(email__startswith="e2e.", email__endswith="@mediconnect.dev")
                # patients an E2E hospital created in Patient management (they may have no email)
                | Q(hospital_links__created_account=True, hospital_links__hospital__name__startswith="E2E ")
            ).distinct()
            n_users = users.count()
            users.delete()  # cascades: profiles, admin links, appointments, records, notifications, chats
            hospitals = Hospital.objects.filter(name__startswith="E2E ")
            n_hospitals = hospitals.count()
            hospitals.delete()  # their staff records go too
            Department.objects.filter(name__startswith="E2E Dept ").delete()  # typed in hospital-profile.spec (2026-11-24)
            # Test hospitals asking to connect notify every platform admin, including real ones: remove
            # those notifications too (they point to hospitals that no longer exist). The same for a test
            # hospital changing its name or city (hospital profile, 2026-11-20), and for test support messages.
            n_notes, _ = Notification.objects.filter(
                Q(kind__startswith="connection_") | Q(kind__in=["hospital_updated", "support_request"]),
                message__contains="E2E ").delete()
        self.stdout.write(f"Removed {n_users} e2e accounts, {n_hospitals} E2E hospitals and {n_notes} notifications about them.")
        try:
            from apps.search.documents import rebuild_all

            rebuild_all()
            self.stdout.write("Search index rebuilt.")
        except Exception as e:  # search down: data is still removed; rebuild later with search_index --rebuild
            self.stderr.write(f"Search index not rebuilt: {e}")
