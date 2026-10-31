"""
Find a hospital on OpenStreetMap (Nominatim): its address, map pin and (often) its website.
Nominatim's usage policy: identify ourselves with a User-Agent and keep to ~1 request/second.
We only call it once per scrape job, never per keystroke.
"""

import httpx
from django.conf import settings


def find_hospital(query: str) -> dict | None:
    params = {"q": query, "format": "jsonv2", "addressdetails": 1, "extratags": 1, "limit": 5}
    resp = httpx.get(settings.NOMINATIM_URL, params=params, timeout=15, headers={"User-Agent": settings.SCRAPER_USER_AGENT})
    resp.raise_for_status()
    results = resp.json()
    # Prefer places OpenStreetMap tags as hospitals/clinics.
    results.sort(key=lambda r: 0 if r.get("type") in ("hospital", "clinic") or r.get("category") == "amenity" else 1)
    if not results:
        return None
    r = results[0]
    addr = r.get("address", {})
    tags = r.get("extratags") or {}
    return {
        "name": r.get("name") or query,
        "address": r.get("display_name", "")[:300],
        "city": addr.get("city") or addr.get("town") or addr.get("village") or addr.get("county") or "",
        "state": addr.get("state", ""),
        "country": addr.get("country", ""),
        "lat": float(r["lat"]),
        "lng": float(r["lon"]),
        "website": tags.get("website") or tags.get("contact:website") or tags.get("url") or "",
        "phone": tags.get("phone") or tags.get("contact:phone") or "",
    }
