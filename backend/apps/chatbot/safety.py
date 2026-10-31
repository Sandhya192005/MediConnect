import re

from django.conf import settings
from django.core.cache import cache

# Simple keyword check that runs before the AI. If it matches, the UI always shows the
# emergency banner, even if the model's answer somehow didn't mention it.
EMERGENCY_PATTERNS = re.compile(
    r"chest pain|heart attack|can'?t breathe|cannot breathe|not breathing|difficulty breathing|"
    r"unconscious|fainted|stroke|seizure|severe bleeding|bleeding heavily|overdose|poison|"
    r"suicid|kill myself|end my life|self[- ]harm",
    re.IGNORECASE,
)

EMERGENCY_NOTICE = (
    "If this is an emergency, call 112 (national emergency) or 108 (ambulance) now, "
    "or go to the nearest emergency department. For mental health support, call Tele-MANAS 14416."
)


def is_emergency(text: str) -> bool:
    return bool(EMERGENCY_PATTERNS.search(text or ""))


def check_rate_limit(user_id: int) -> bool:
    """True if the user may send another message. Counter lives in Redis (Django cache)."""
    limit = settings.CHAT_RATE_LIMIT
    window = settings.CHAT_RATE_WINDOW_SECONDS
    key = f"chat:rl:{user_id}"
    if cache.add(key, 1, timeout=window):  # first message in this window
        return True
    try:
        count = cache.incr(key)
    except ValueError:  # expired between add() and incr()
        cache.set(key, 1, timeout=window)
        return True
    return count <= limit
