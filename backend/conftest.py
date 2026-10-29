import pytest

from config.celery import app as celery_app


@pytest.fixture(autouse=True)
def _test_settings(settings):
    """Tests run without Redis or a mail server."""
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
    settings.CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
    settings.ES_INDEX_PREFIX = "test_mediconnect"  # never touch the real search indexes
    celery_app.conf.task_always_eager = True  # run .delay() tasks immediately, in-process
    celery_app.conf.task_eager_propagates = True
    from django.core.cache import cache

    from channels.layers import channel_layers

    cache.clear()
    channel_layers.backends.clear()  # fresh in-memory layer per test (each test has its own event loop)
    yield
    channel_layers.backends.clear()
