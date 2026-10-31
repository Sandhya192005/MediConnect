"""
Download every hospital in a map square from OpenStreetMap (Overpass API, free, no key).
Usage policy: identify ourselves, keep requests few (we cache each square for 24 h).
"""

import httpx
from django.conf import settings

OVERPASS_URL = "https://overpass-api.de/api/interpreter"


def _website(tags: dict) -> str:
    url = (tags.get("website") or tags.get("contact:website") or tags.get("url") or "").strip()
    if url and not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url[:200]


def hospitals_in_box(south: float, west: float, north: float, east: float) -> list[dict]:
    box = f"{south},{west},{north},{east}"
    query = f'[out:json][timeout:90];(nwr["amenity"="hospital"]({box});nwr["healthcare"="hospital"]({box}););out center tags;'
    resp = httpx.post(OVERPASS_URL, data={"data": query}, timeout=120, headers={"User-Agent": settings.SCRAPER_USER_AGENT})
    resp.raise_for_status()

    out, seen = [], set()
    for el in resp.json().get("elements", []):
        tags = el.get("tags") or {}
        name = (tags.get("name:en") or tags.get("name") or "").strip()
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lng = el.get("lon") or (el.get("center") or {}).get("lon")
        osm_id = f"{el['type']}/{el['id']}"
        if not name or lat is None or lng is None or osm_id in seen:
            continue  # unnamed buildings aren't useful to patients
        seen.add(osm_id)
        street = " ".join(filter(None, [tags.get("addr:housenumber"), tags.get("addr:street")]))
        out.append({
            "osm_id": osm_id,
            "name": name[:200],
            "lat": float(lat),
            "lng": float(lng),
            "website": _website(tags),
            "phone": (tags.get("phone") or tags.get("contact:phone") or "").split(";")[0].strip()[:30],
            "address": ", ".join(filter(None, [street, tags.get("addr:suburb"), tags.get("addr:postcode")]))[:300],
            "city": (tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:district") or "")[:100],
            "state": (tags.get("addr:state") or "")[:100],
        })
    return out
