import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# WebSocket routing (Django Channels) is added in Phase 4.
application = get_asgi_application()
