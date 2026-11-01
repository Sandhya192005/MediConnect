import pytest

from config.celery import app as celery_app


@pytest.fixture(autouse=True)
def _test_settings(settings):
    """Tests run without Redis or a mail server."""
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
    settings.CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
    settings.ES_INDEX_PREFIX = "test_mediconnect"  # never touch the real search indexes
    settings.OPENAI_API_KEY = ""  # tests never call the real OpenAI (they use fakes)
    settings.SCRAPER_ALLOWED_PRIVATE_HOSTS = ["mockhospital"]
    celery_app.conf.task_always_eager = True  # run .delay() tasks immediately, in-process
    celery_app.conf.task_eager_propagates = True
    from django.core.cache import cache

    from channels.layers import channel_layers

    cache.clear()
    channel_layers.backends.clear()  # fresh in-memory layer per test (each test has its own event loop)
    yield
    channel_layers.backends.clear()


class FakeWikidata:
    """Stands in for httpx.Client in apps.scraper.wikidata. Default: Wikidata knows nothing."""

    def __init__(self, search=None, entities=None):
        self.search, self.entities, self.calls = search or [], entities or {}, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, url, params=None):
        self.calls.append(params)
        if params["action"] == "wbsearchentities":
            body = {"search": self.search}
        else:
            body = {"entities": {i: self.entities[i] for i in params["ids"].split("|") if i in self.entities}}
        return _FakeResponse(body)


class _FakeResponse:
    def __init__(self, body):
        self.body = body

    def raise_for_status(self):
        pass

    def json(self):
        return self.body


@pytest.fixture(autouse=True)
def fake_wikidata(monkeypatch):
    """Tests never call the real Wikidata. Set .search / .entities on the returned fake to script answers."""
    from apps.scraper import wikidata

    fake = FakeWikidata()
    monkeypatch.setattr(wikidata, "_client", lambda: fake)
    return fake
