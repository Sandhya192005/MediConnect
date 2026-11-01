"""
Find a hospital's official website on Wikidata (free, no key) when OpenStreetMap doesn't list one.

Wikidata is the database behind Wikipedia. Each item can have an "official website" (property P856).
Two ways in:
  1. OpenStreetMap often links a hospital to its Wikidata item (tags wikidata / operator:wikidata / brand:wikidata).
  2. Otherwise we search Wikidata by the hospital's name. Names are ambiguous ("Institute of Child Health"
     exists in Chennai *and* Athens), so a search result is only accepted when it's near the hospital
     (coordinates within NEAR_KM) or, for hospital groups without one location, based in the same country.
"""

import hashlib
import logging
import math
import re

import httpx
from django.conf import settings
from django.core.cache import cache

log = logging.getLogger(__name__)

API = "https://www.wikidata.org/w/api.php"
NEAR_KM = 15
CACHE_SECONDS = 30 * 24 * 3600  # found: keep 30 days
NOT_FOUND_CACHE_SECONDS = 7 * 24 * 3600
P_WEBSITE, P_COORDS, P_COUNTRY = "P856", "P625", "P17"
QID = re.compile(r"^Q\d{1,12}$")

# Words that say nothing about *which* hospital it is, ignored when comparing names.
GENERIC = {
    "hospital", "hospitals", "clinic", "clinics", "the", "and", "of", "multispeciality", "multispecialty",
    "multi", "speciality", "specialty", "super", "medical", "centre", "center", "centres", "centers",
    "pvt", "private", "ltd", "limited", "a", "in", "&", "-", "block", "unit", "branch",
}


def _client() -> httpx.Client:
    # Wikimedia asks every API user to identify themselves with a contact link.
    return httpx.Client(timeout=15, headers={"User-Agent": settings.SCRAPER_USER_AGENT})


def _claim_values(entity: dict, prop: str) -> list:
    out = []
    for claim in entity.get("claims", {}).get(prop, []):
        if claim.get("rank") == "deprecated":
            continue
        value = claim.get("mainsnak", {}).get("datavalue", {}).get("value")
        if value is not None:
            out.append(value)
    return out


def _website(entity: dict) -> str:
    for url in _claim_values(entity, P_WEBSITE):
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            return url[:200]
    return ""


class WikidataError(httpx.HTTPError):
    """Wikidata answered with an error (e.g. rate limited). Never treat that as "not found"."""


def _get(client: httpx.Client, params: dict) -> dict:
    resp = client.get(API, params={**params, "format": "json"})
    resp.raise_for_status()
    body = resp.json()
    if "error" in body:  # errors come back as HTTP 200 with an "error" key
        raise WikidataError(str(body["error"].get("code") or body["error"])[:200])
    return body


def _entities(client: httpx.Client, ids: list[str]) -> dict:
    out = {}
    for i in range(0, len(ids), 50):  # the API takes at most 50 ids per call
        body = _get(client, {"action": "wbgetentities", "ids": "|".join(ids[i:i + 50]),
                             "props": "claims|labels", "languages": "en"})
        out.update({k: v for k, v in body.get("entities", {}).items() if "missing" not in v})
    return out


def websites_for_ids(ids: list[str]) -> dict[str, str]:
    """{qid: official website} for Wikidata ids taken from OpenStreetMap tags."""
    ids = sorted({i for i in ids if i and QID.match(i)})
    if not ids:
        return {}
    with _client() as client:
        entities = _entities(client, ids)
    return {qid: site for qid, e in entities.items() if (site := _website(e))}


def _words(name: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", name.lower())
    # "hospitals" == "hospital", "agarwals" == "agarwal": drop a trailing s on longer words
    return {w[:-1] if len(w) > 4 and w.endswith("s") else w for w in words} - GENERIC


def names_match(name: str, label: str) -> bool:
    """
    Does the Wikidata label fit our hospital's name?
      - every distinctive word of the label is in the name: "Apollo Hospitals" fits "Apollo Hospital, Vanagaram";
      - or the name's words are all in the label, but only for names with 2+ distinctive words
        ("Cancer Institute" fits "Adyar Cancer Institute"; "Sri Hospital" must not fit "Sri Ramachandra …").
    """
    wn, wl = _words(name), _words(label)
    if not wn or not wl:
        return False
    return wl <= wn or (len(wn) >= 2 and wn <= wl)


def _km(lat1, lng1, lat2, lng2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def _place_ok(entity: dict, lat: float | None, lng: float | None) -> bool:
    coords = [c for c in _claim_values(entity, P_COORDS) if isinstance(c, dict) and "latitude" in c]
    if coords and lat is not None and lng is not None:
        return any(_km(lat, lng, c["latitude"], c["longitude"]) <= NEAR_KM for c in coords)
    # No single location (e.g. a hospital chain): accept only if it's from the same country.
    countries = {c.get("id") for c in _claim_values(entity, P_COUNTRY) if isinstance(c, dict)}
    return settings.DIRECTORY_COUNTRY_QID in countries


def find_website(name: str, lat: float | None = None, lng: float | None = None) -> dict | None:
    """Search Wikidata by name. Returns {"url", "qid", "label"} or None. Cached (also "not found") for 30 days."""
    name = (name or "").strip()
    if not _words(name):
        return None  # "Hospital" alone could be anything
    digest = hashlib.sha1(name.lower().encode()).hexdigest()
    key = f"wikidata:site:{digest}:{round(lat or 0, 1)}:{round(lng or 0, 1)}"
    cached = cache.get(key)
    if cached is not None:
        return cached or None

    with _client() as client:
        body = _get(client, {"action": "wbsearchentities", "search": name[:200], "language": "en",
                             "type": "item", "limit": 5})
        hits = [h for h in body.get("search", []) if names_match(name, h.get("label", ""))]
        entities = _entities(client, [h["id"] for h in hits]) if hits else {}

    found = None
    for h in hits:  # keep Wikidata's ranking: best match first
        e = entities.get(h["id"])
        if e and (site := _website(e)) and _place_ok(e, lat, lng):
            found = {"url": site, "qid": h["id"], "label": h.get("label", "")}
            break
    cache.set(key, found or {}, CACHE_SECONDS if found else NOT_FOUND_CACHE_SECONDS)
    return found
