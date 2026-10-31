"""
The hospital directory: every hospital on the map, not only MediConnect partners.

  patient opens the map → which ~11 km squares ("tiles") does the search cover?
  → tiles not refreshed in 24 h are queued as background Celery jobs (one per tile, never twice)
  → the job downloads that tile's hospitals from OpenStreetMap and saves/updates them
  → the map shows what we already have right away and fills in as tiles finish.
"""

import math
from datetime import timedelta

from django.conf import settings
from django.contrib.gis.geos import Point
from django.contrib.gis.measure import D
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.hospitals.models import Hospital

from . import overpass
from .models import OsmTile

TILE = 0.1  # degrees (~11 km)
MAX_TILE_RADIUS_KM = 10  # tiles are loaded around the patient up to this distance
STUCK_AFTER = timedelta(minutes=10)


def tile_key(south: float, west: float) -> str:
    return f"{round(south * 10)}_{round(west * 10)}"


def tiles_for(lat: float, lng: float, radius_km: float) -> list[tuple[str, float, float]]:
    r = min(radius_km, MAX_TILE_RADIUS_KM)
    dlat = r / 111.0
    dlng = r / (111.0 * max(math.cos(math.radians(lat)), 0.1))
    tiles = []
    s = math.floor((lat - dlat) / TILE)
    while s * TILE <= lat + dlat:
        w = math.floor((lng - dlng) / TILE)
        while w * TILE <= lng + dlng:
            south, west = round(s * TILE, 1), round(w * TILE, 1)
            tiles.append((tile_key(south, west), south, west))
            w += 1
        s += 1
    return tiles


RETRY_FAILED_AFTER = timedelta(minutes=10)


def _needs_sync(tile: OsmTile) -> bool:
    now = timezone.now()
    if tile.status in ("pending", "running"):
        return now - tile.updated_at > STUCK_AFTER  # a crashed job: allow a retry
    if tile.status == "done" and tile.synced_at:
        return now - tile.synced_at > timedelta(hours=settings.SCRAPER_FRESH_HOURS)
    if tile.status == "failed":
        return now - tile.updated_at > RETRY_FAILED_AFTER  # don't hammer Overpass while it's down
    return True  # new


def _set(tile_pk, **fields):
    # .update() skips auto_now, so set updated_at ourselves (the lock and "stuck" check rely on it).
    return OsmTile.objects.filter(pk=tile_pk).update(updated_at=timezone.now(), **fields)


def ensure_tiles(lat: float, lng: float, radius_km: float) -> bool:
    """Queue background downloads for stale tiles. Returns True while any tile is still loading."""
    from .tasks import sync_osm_tile_task

    loading = False
    for key, south, west in tiles_for(lat, lng, radius_km):
        tile, _ = OsmTile.objects.get_or_create(key=key, defaults={"south": south, "west": west})
        if _needs_sync(tile):
            # Conditional update = a lock: only the request that still sees the old state wins.
            claimed = OsmTile.objects.filter(pk=tile.pk, status=tile.status, updated_at=tile.updated_at).update(
                status="pending", updated_at=timezone.now()
            )
            if claimed:
                transaction.on_commit(lambda k=key: sync_osm_tile_task.delay(k))
            loading = True
        elif tile.status in ("pending", "running"):
            loading = True
    return loading


def sync_tile(key: str) -> int:
    from apps.search.signals import indexing_suspended
    from apps.search.tasks import index_hospitals_bulk_task

    tile = OsmTile.objects.get(key=key)
    _set(tile.pk, status="running")
    try:
        items = overpass.hospitals_in_box(tile.south, tile.west, round(tile.south + TILE, 1), round(tile.west + TILE, 1))
    except Exception:
        _set(tile.pk, status="failed")
        raise
    with indexing_suspended():  # one bulk search update below instead of hundreds of small ones
        ids = upsert_hospitals(items)
    _set(tile.pk, status="done", synced_at=timezone.now(), hospitals_found=len(items))
    transaction.on_commit(lambda: index_hospitals_bulk_task.delay(ids))
    return len(items)


def upsert_hospitals(items: list[dict]) -> list[int]:
    """Create or update hospitals from OpenStreetMap without ever overwriting partner data."""
    ids = []
    known = {h.osm_id: h for h in Hospital.objects.filter(osm_id__in=[i["osm_id"] for i in items])}
    for item in items:
        point = Point(item["lng"], item["lat"], srid=4326)
        h = known.get(item["osm_id"])
        if h is None:
            # Same hospital already in MediConnect (added by an admin or the scraper)? Link it, don't duplicate.
            h = Hospital.objects.filter(
                osm_id__isnull=True, name__iexact=item["name"], location__dwithin=(point, D(m=300))
            ).first()
            if h:
                h.osm_id = item["osm_id"]
        if h is None:
            h = Hospital(
                osm_id=item["osm_id"], name=item["name"], source=Hospital.Source.OSM,
                is_approved=False,  # listed for patients to check, not a partner
                location=point, location_verified=False,
            )
        if h.source == Hospital.Source.OSM:
            h.name, h.location = item["name"], point  # OSM is the source for these, keep them current
        # Only fill empty fields: never overwrite what an admin or the website scrape saved.
        for field in ("website", "phone", "address", "city", "state"):
            if item[field] and not getattr(h, field):
                setattr(h, field, item[field])
        if h.location is None:
            h.location, h.location_verified = point, False
        try:
            with transaction.atomic():
                h.save()
        except IntegrityError:  # another tile saved the same hospital a moment ago
            continue
        ids.append(h.id)
    return ids
