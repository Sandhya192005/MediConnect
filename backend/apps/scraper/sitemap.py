"""
Find a hospital's doctor pages through its sitemap.

Many hospital websites (e.g. MIOT) don't link their doctor profiles from the homepage, so following
links from the start page never reaches them. A sitemap is the site's own list of its pages
(robots.txt "Sitemap:" lines, or /sitemap.xml, /wp-sitemap.xml, /sitemap_index.xml). We read it and pick
the addresses that look like doctor pages ("/doctors/", "/dr-rajan-…", "/meet-the-doctors/", …).

Same safety rules as the browser: public addresses only (every redirect is checked), same website,
robots.txt respected by the caller, small limits on how many files and how much data we read.
"""

import logging
import re
import time
from urllib.parse import urljoin, urlparse

import httpx
from django.conf import settings

from .safety import UnsafeURL, check_public_url

log = logging.getLogger(__name__)

CANDIDATES = ("/sitemap.xml", "/wp-sitemap.xml", "/sitemap_index.xml")
MAX_FILES = 25  # sitemap files read per website
MAX_BYTES = 5_000_000
MAX_SECONDS = 20  # time spent reading sitemap files; the pages themselves need the rest of the budget
DOCTOR_URL = re.compile(
    r"/(?:dr[-_.][a-z]|doctors?(?:[-_/]|\.html?$|$)|our[-_]?doctors|find[-_]a[-_]doctor|meet[-_]the[-_]doctors?|"
    r"consultants?(?:[-_/]|$)|our[-_]team|specialists?(?:/|$)|medical[-_]team)",
    re.I,
)
SKIP_URL = re.compile(r"thank[-_]?you|terms|privacy|career|job|login|news|blog|event|press|video|camp|\.pdf$|\.jpe?g$|\.png$", re.I)
# Sitemap files more likely to list doctors are read first.
GOOD_SITEMAP = re.compile(r"doctor|team|staff|people|consultant|physician|page", re.I)
LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.I)


def _same_site(a: str, b: str) -> bool:
    ha, hb = urlparse(a).hostname or "", urlparse(b).hostname or ""
    return ha.removeprefix("www.") == hb.removeprefix("www.")


def _get(client: httpx.Client, url: str, site: str) -> str | None:
    """GET with redirects followed by hand, so every hop is checked (never a private address, same site)."""
    for _ in range(4):
        try:
            url = check_public_url(url)
        except UnsafeURL:
            return None
        if not _same_site(url, site):
            return None
        resp = client.get(url)
        if resp.is_redirect:
            url = urljoin(url, resp.headers.get("location", ""))
            continue
        if resp.status_code != 200 or len(resp.content) > MAX_BYTES:
            return None
        return resp.text
    return None


def _robots_sitemaps(client: httpx.Client, site: str) -> list[str]:
    text = _get(client, urljoin(site, "/robots.txt"), site) or ""
    return [line.split(":", 1)[1].strip() for line in text.splitlines() if line.lower().startswith("sitemap:")]


def doctor_urls(start_url: str, allowed, limit: int | None = None) -> list[str]:
    """
    Doctor-looking page addresses from the site's sitemap, best first. `allowed(url)` is robots.txt.
    Never raises: a site without a sitemap just gives [].
    """
    limit = limit or settings.SCRAPER_MAX_DOCTOR_PAGES
    found: list[str] = []
    try:
        with httpx.Client(timeout=15, follow_redirects=False, headers={"User-Agent": settings.SCRAPER_USER_AGENT}) as client:
            queue = _robots_sitemaps(client, start_url) or [urljoin(start_url, c) for c in CANDIDATES]
            seen, files, stop_at = set(), 0, time.monotonic() + MAX_SECONDS
            while queue and files < MAX_FILES and time.monotonic() < stop_at:
                sm = queue.pop(0)
                if sm in seen or sm.endswith(".gz"):
                    continue
                seen.add(sm)
                text = _get(client, sm, start_url)
                files += 1
                if not text or "<loc>" not in text.lower():
                    continue
                locs = LOC.findall(text)
                if "<sitemapindex" in text.lower():  # an index of more sitemap files
                    queue += sorted(locs, key=lambda u: not GOOD_SITEMAP.search(u))
                    continue
                for u in locs:
                    if (_same_site(u, start_url) and DOCTOR_URL.search(urlparse(u).path)
                            and not SKIP_URL.search(u) and u not in found and allowed(u)):
                        found.append(u)
    except httpx.HTTPError as e:
        log.info("No usable sitemap for %s: %s", start_url, e)
    return _mix(found, limit)


def _mix(urls: list[str], limit: int) -> list[str]:
    """
    List pages ("/doctors/", "/meet-the-doctors/") name many doctors, so they go first, but only up to
    half the budget: sitemaps often keep removed list pages (MIOT's 8 "meet the doctors" pages are all
    404s), and those must not crowd out the real profile pages.
    """
    profile = re.compile(r"/dr[-_.]", re.I)
    lists = sorted((u for u in urls if not profile.search(u)), key=len)
    profiles = [u for u in urls if profile.search(u)]
    picked = lists[: limit // 2]
    picked += profiles[: limit - len(picked)]
    picked += [u for u in lists if u not in picked][: limit - len(picked)]
    return picked
