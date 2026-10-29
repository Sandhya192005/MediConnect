"""
Celery app. Redis is the broker: Django puts tasks in Redis, the worker container picks them up.
Celery Beat is the scheduler that adds periodic tasks (see CELERY_BEAT_SCHEDULE in settings).
"""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("mediconnect")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()  # finds tasks.py in every installed app
