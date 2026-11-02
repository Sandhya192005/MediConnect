"""
Playwright part: open the hospital's website in a headless Chromium and read the text of
the start page plus a few useful pages (doctors, departments, contact, timings).
Doctor pages the homepage doesn't link to are found through the site's sitemap (sitemap.py).

Rules: same website only, robots.txt respected, page-count and time limits, no logins,
no form submissions, no CAPTCHA solving. Images/fonts/media are skipped to be light on the site.
"""

import re
import time
from urllib.parse import urljoin, urlparse

from django.conf import settings

from . import sitemap
from .safety import Robots, UnsafeURL, check_public_url

USEFUL_LINK = re.compile(
    r"doctor|consultant|specialist|speciali[sz]|department|our[- ]team|find[- ]a|contact|timing|opd|appointment|book", re.I
)
SKIP_LINK = re.compile(r"login|sign[- ]?in|register|career|job|blog|news|\.pdf$|\.jpg$|\.png$", re.I)
MAX_TEXT_PER_PAGE = 15_000


class RobotsBlocked(Exception):
    pass


def _same_site(a: str, b: str) -> bool:
    ha, hb = urlparse(a).hostname or "", urlparse(b).hostname or ""
    return ha.removeprefix("www.") == hb.removeprefix("www.")


def fetch_pages(start_url: str, max_pages: int | None = None) -> list[dict]:
    """Returns [{"url", "title", "text", "links": [{"url","text"}]}]. Imported lazily so tests don't need a browser."""
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright

    # Stop opening new pages after this many seconds and keep what we have: the Celery job is
    # stopped at 150 s, and some hospital sites take 5–10 s per page.
    deadline = time.monotonic() + settings.SCRAPER_TIME_BUDGET_S
    max_pages = max_pages or settings.SCRAPER_MAX_PAGES
    start_url = check_public_url(start_url)
    robots = Robots(start_url)
    if not robots.allowed(start_url):
        raise RobotsBlocked("The hospital's website doesn't allow automated reading (robots.txt).")

    # Doctor pages from the sitemap get their own budget on top of the normal pages.
    doctor_pages = sitemap.doctor_urls(start_url, robots.allowed)
    max_pages += len(doctor_pages)
    max_visits = max_pages + 8  # failed pages (404…) don't count as read; this caps the total time spent
    pages, queue, seen = [], [start_url, *doctor_pages], set()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=settings.SCRAPER_USER_AGENT, java_script_enabled=True)
        context.route(
            "**/*",
            lambda route: route.abort() if route.request.resource_type in ("image", "media", "font") else route.continue_(),
        )
        page = context.new_page()
        page.set_default_timeout(settings.SCRAPER_PAGE_TIMEOUT_MS)
        try:
            while queue and len(pages) < max_pages and len(seen) < max_visits and time.monotonic() < deadline:
                url = queue.pop(0).split("#")[0]
                if url in seen:
                    continue
                seen.add(url)
                try:
                    check_public_url(url)
                except UnsafeURL:
                    continue
                if not robots.allowed(url):
                    continue
                try:
                    resp = page.goto(url, wait_until="domcontentloaded")
                    if resp is not None and resp.status >= 400:
                        continue  # removed page ("404"): skip it, don't count it
                    # A redirect could have taken us somewhere else: check where we ended up.
                    check_public_url(page.url)
                    if not _same_site(page.url, start_url) and pages:
                        continue
                    page.wait_for_timeout(800)  # let small scripts render content
                    text = page.inner_text("body")[:MAX_TEXT_PER_PAGE]
                    links = page.eval_on_selector_all(
                        "a[href]", "els => els.map(e => ({url: e.href, text: (e.innerText || '').trim().slice(0, 80)}))"
                    )
                except (PlaywrightError, UnsafeURL):
                    continue
                pages.append({"url": page.url, "title": page.title()[:200], "text": text, "links": links[:300]})

                # Queue useful links on the same website, most promising first.
                for link in links:
                    href = urljoin(page.url, link["url"])
                    label = f"{link['text']} {href}"
                    if _same_site(href, start_url) and USEFUL_LINK.search(label) and not SKIP_LINK.search(label):
                        if href not in seen and href not in queue:
                            queue.append(href)
        finally:
            context.close()
            browser.close()
    return pages
