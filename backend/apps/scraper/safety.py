"""
Safety checks before the scraper visits any URL.

1. SSRF protection: a URL from a user must never make our server call internal addresses
   (localhost, 10.x, 192.168.x, the Docker network, cloud metadata 169.254.169.254, …).
2. robots.txt: if the hospital's site says bots may not read a page, we don't.
"""

import ipaddress
import socket
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx
from django.conf import settings


class UnsafeURL(ValueError):
    pass


def check_public_url(url: str) -> str:
    """Return the normalized URL, or raise UnsafeURL."""
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise UnsafeURL("Only http(s) website addresses are allowed.")
    if parsed.username or parsed.password:
        raise UnsafeURL("Website addresses with a username/password are not allowed.")
    if parsed.port not in (None, 80, 443):
        raise UnsafeURL("Only standard web ports are allowed.")

    host = parsed.hostname.lower()
    if host in settings.SCRAPER_ALLOWED_PRIVATE_HOSTS:  # the mock hospital in Docker
        return parsed.geturl()

    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(host, None)}
    except socket.gaierror:
        raise UnsafeURL("That website address doesn't exist.")
    for addr in addresses:
        ip = ipaddress.ip_address(addr)
        if not ip.is_global:  # private, loopback, link-local, reserved, multicast…
            raise UnsafeURL("That address points to a private network and can't be used.")
    return parsed.geturl()


class Robots:
    """Caches one site's robots.txt for the duration of a scrape."""

    def __init__(self, base_url: str):
        self.parser = RobotFileParser()
        robots_url = urljoin(base_url, "/robots.txt")
        try:
            # No redirects: a redirect could point at a private address.
            resp = httpx.get(robots_url, timeout=10, follow_redirects=False, headers={"User-Agent": settings.SCRAPER_USER_AGENT})
            if resp.status_code >= 500:
                self.parser.disallow_all = True  # server error: be careful, treat as "no"
            elif resp.status_code >= 400:
                self.parser.allow_all = True  # no robots.txt: allowed
            else:
                self.parser.parse(resp.text.splitlines())
        except httpx.HTTPError:
            self.parser.allow_all = True  # unreachable robots.txt; the page fetch will fail on its own if the site is down

    def allowed(self, url: str) -> bool:
        return self.parser.can_fetch(settings.SCRAPER_USER_AGENT, url)
