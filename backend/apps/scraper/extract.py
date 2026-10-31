"""
Turn page text into clean, structured hospital data.

- With an OpenAI key: the model reads the text and fills a fixed JSON shape. It is told to
  copy only what is written on the pages and leave everything else empty (never guess).
- Without a key (or if OpenAI fails): a simple rule-based fallback finds phone numbers,
  emails and "Dr. Name – Specialty" lines.
Either way, the output is validated and cleaned before anything is saved.
"""

import json
import logging
import re
from urllib.parse import urlparse

from django.conf import settings

log = logging.getLogger(__name__)

MAX_DOCTORS = 150
PHONE = re.compile(r"(?:\+?\d[\d\s\-()]{7,16}\d)")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
DOCTOR_LINE = re.compile(
    r"\bDr\.?\s+(?P<name>[A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+){0,3})"
    r"(?:\s*[,\-–|:]\s*(?P<spec>[A-Za-z &/()]{3,60}))?"
)
_DAY = r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?"
_TIME = r"\d{1,2}(?::\d{2})?\s*(?i:am|pm)?"
# e.g. "Mon–Sat 9:00 am – 1:00 pm", "Mon, Wed, Fri 4:00 pm – 7:00 pm", "Saturday 10 am to 1 pm"
TIMING = re.compile(
    rf"{_DAY}(?:\s*(?:,|&|/|–|-|to)\s*{_DAY})*\s*[:,]?\s*{_TIME}\s*(?:–|-|to)\s*\d{{1,2}}(?::\d{{2}})?\s*(?i:am|pm)"
)
GENERAL_HOURS_LINE = re.compile(r"\b(?:OPD|opening|visiting)\b|\b(?:timings?|hours)\b", re.I)

SCHEMA_HINT = {
    "hospital_name": "string",
    "address": "string",
    "phones": ["string"],
    "emails": ["string"],
    "booking_url": "string (the hospital's own online appointment page, if a link exists)",
    "opd_timings": "string (general outpatient hours as written)",
    "departments": ["string"],
    "doctors": [{"name": "string", "specialization": "string", "qualification": "string", "timings": "string"}],
    "notes": "string (short, e.g. 'Appointments by phone only')",
}

SYSTEM = (
    "You extract facts about a hospital from text copied from its own website. "
    "Copy ONLY information that is written in the text. If something is not in the text, use an empty "
    "string or empty list. Never guess or add doctors, phone numbers, timings or links. "
    "Return one JSON object with exactly these keys: " + json.dumps(SCHEMA_HINT)
)


def _clean_str(v, n=200) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n]


def _clean_url(v: str, site_url: str) -> str:
    v = _clean_str(v, 500)
    p = urlparse(v)
    site = (urlparse(site_url).hostname or "").removeprefix("www.")
    host = (p.hostname or "").removeprefix("www.")
    # Only http(s) links on the hospital's own site (or a sub-domain of it).
    if p.scheme in ("http", "https") and host and (host == site or host.endswith("." + site)):
        return v
    return ""


def normalize(raw: dict, site_url: str) -> dict:
    """Validate whatever came back (LLM or fallback) into a safe, predictable shape."""
    doctors, seen = [], set()
    for d in raw.get("doctors") or []:
        if not isinstance(d, dict):
            continue
        name = _clean_str(d.get("name"), 150)
        name = re.sub(r"^(dr\.?\s*)", "Dr. ", name, flags=re.I) if name else ""
        if len(name) < 6 or name.lower() in seen:
            continue
        seen.add(name.lower())
        doctors.append({
            "name": name,
            "specialization": _clean_str(d.get("specialization"), 150),
            "qualification": _clean_str(d.get("qualification"), 200),
            "timings": _clean_str(d.get("timings"), 200),
        })
        if len(doctors) >= MAX_DOCTORS:
            break

    def str_list(key, n=10):
        out = []
        for v in raw.get(key) or []:
            s = _clean_str(v, 120)
            if s and s not in out:
                out.append(s)
        return out[:n]

    return {
        "hospital_name": _clean_str(raw.get("hospital_name"), 200),
        "address": _clean_str(raw.get("address"), 300),
        "phones": [p for p in str_list("phones", 5) if PHONE.fullmatch(p)],
        "emails": [e for e in str_list("emails", 5) if EMAIL.fullmatch(e)],
        "booking_url": _clean_url(raw.get("booking_url", ""), site_url),
        "opd_timings": _clean_str(raw.get("opd_timings"), 200),
        "departments": str_list("departments", 40),
        "doctors": doctors,
        "notes": _clean_str(raw.get("notes"), 300),
    }


def rule_based(pages: list[dict]) -> dict:
    """No-AI fallback: good enough for simple, well-labelled pages."""
    text = "\n".join(p["text"] for p in pages)
    doctors = []
    for line in text.splitlines():
        m = DOCTOR_LINE.search(line)
        if m:
            t = TIMING.search(line)
            doctors.append({
                "name": "Dr. " + m.group("name"),
                "specialization": (m.group("spec") or "").strip(),
                "timings": t.group(0) if t else "",
            })
    booking = ""
    for p in pages:
        for link in p.get("links", []):
            if re.search(r"appointment|book", f"{link['text']} {link['url']}", re.I):
                booking = link["url"]
                break
        if booking:
            break
    # General hours: prefer a line that says "OPD"/"timings"/"hours" and isn't about one doctor.
    timing = None
    for line in text.splitlines():
        if GENERAL_HOURS_LINE.search(line) and not DOCTOR_LINE.search(line):
            timing = TIMING.search(line)
            if timing:
                break
    return {
        "hospital_name": pages[0]["title"] if pages else "",
        "phones": PHONE.findall(text)[:5],
        "emails": EMAIL.findall(text)[:5],
        "booking_url": booking,
        "opd_timings": timing.group(0) if timing else "",
        "doctors": doctors,
    }


def with_openai(pages: list[dict]) -> dict:
    from openai import OpenAI

    client = OpenAI(api_key=settings.OPENAI_API_KEY, timeout=60, max_retries=1)
    corpus = "\n\n".join(f"### PAGE {p['url']}\n{p['text']}" for p in pages)[:60_000]
    resp = client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        response_format={"type": "json_object"},
        temperature=0,
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": corpus}],
    )
    return json.loads(resp.choices[0].message.content or "{}")


def extract(pages: list[dict], site_url: str) -> tuple[dict, str]:
    """Returns (clean_data, method) where method is 'openai' or 'rules'."""
    if settings.OPENAI_API_KEY:
        try:
            return normalize(with_openai(pages), site_url), "openai"
        except Exception as e:  # bad key, no credits, network, bad JSON…
            log.warning("OpenAI extraction failed, using rule-based fallback: %s", e)
    return normalize(rule_based(pages), site_url), "rules"
