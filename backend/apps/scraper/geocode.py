"""
Find a hospital on OpenStreetMap (Nominatim): its address, map pin and (often) its website.
Nominatim's usage policy: identify ourselves with a User-Agent and keep to ~1 request/second.
We only call it once per scrape job, never per keystroke.
"""

import httpx
from django.conf import settings

# Only accept places that OpenStreetMap tags as healthcare. Without this, a typo like
# "applo" matched an island in Finland ("Äpplö") and would have been saved as a "hospital".
HEALTHCARE_TYPES = {"hospital", "clinic", "doctors", "healthcare", "centre"}


def _is_healthcare(r: dict) -> bool:
    tags = r.get("extratags") or {}
    return (
        (r.get("category") in ("amenity", "healthcare") and r.get("type") in HEALTHCARE_TYPES)
        or tags.get("healthcare") in HEALTHCARE_TYPES
        or tags.get("amenity") in ("hospital", "clinic", "doctors")
    )


def find_hospital(query: str) -> dict | None:
    params = {"q": query, "format": "jsonv2", "addressdetails": 1, "extratags": 1, "limit": 10}
    resp = httpx.get(settings.NOMINATIM_URL, params=params, timeout=15, headers={"User-Agent": settings.SCRAPER_USER_AGENT})
    resp.raise_for_status()
    results = [r for r in resp.json() if _is_healthcare(r)]
    if not results:
        return None
    # Prefer hospitals, then places that list a website.
    results.sort(key=lambda r: (r.get("type") != "hospital", not (r.get("extratags") or {}).get("website")))
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
