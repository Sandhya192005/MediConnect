"""
Matching a patient's words to doctors' specialties, for doctors read from hospital websites
(they live in PostgreSQL only, not in Elasticsearch).

Why not plain letter-similarity? Almost every specialty ends in "-ologist" / "-ology", so by letters
alone "gynecologist" looks a lot like "cardiologist" and "neurologist". Here we compare word ROOTS
instead: the shared ending is cut off first ("gynecologist" -> "gynec", "cardiologist" -> "cardi").

The everyday-word groups ("women" = "pregnancy" = "gynecologist" ...) are the same SYNONYMS list
Elasticsearch uses for bookable doctors, so both searches understand the same words.
"""

import re
from difflib import SequenceMatcher

from .indexes import SYNONYMS

# Longest first, so "gynecologist" loses "ologist", not just "ist".
_ENDINGS = ("ologists", "ologist", "ological", "ology", "icians", "ician", "ists", "ist", "ics", "ic", "y")
_MEDICAL_ENDINGS = tuple(e for e in _ENDINGS if e != "y")  # "Cardiology", "Orthopedic", "Pediatrics"...
_MIN_ROOT = 3      # never cut a word down to fewer letters than this
_FUZZY_MIN = 5      # words shorter than this must match exactly ("ent" must not match "eye")
_SIMILAR = 0.75     # how alike two roots must be to count as a typo of each other


def words(text: str) -> list[str]:
    return re.findall(r"[a-z]+", text.lower())


def root(word: str) -> str:
    for ending in _ENDINGS:
        if word.endswith(ending) and len(word) - len(ending) >= _MIN_ROOT:
            return word[: -len(ending)]
    return word


def _alike(a: str, b: str) -> bool:
    """Two words mean the same specialty: equal, or (both long enough) roots that differ by a typo."""
    if a == b:
        return True
    if min(len(a), len(b)) < _FUZZY_MIN:
        return False
    return SequenceMatcher(None, root(a), root(b)).ratio() >= _SIMILAR


def _groups() -> list[list[str]]:
    return [[term.strip().lower() for term in line.split(",")] for line in SYNONYMS]


def needles(query: str) -> tuple[set[str], set[str]]:
    """What to look for in specialty text: word roots, and whole phrases (for multi-word terms)."""
    q_words = words(query)
    roots = {root(w) for w in q_words}
    phrases: set[str] = set()
    q_text = " ".join(q_words)
    for group in _groups():
        hit = any(
            (" " in term and term in q_text) or any(_alike(w, term) for w in q_words if " " not in term)
            for term in group
        )
        if hit:
            for term in group:
                (phrases.add(term) if " " in term else roots.add(root(term)))
    return roots, phrases


def specialty_matches(specialty: str, roots: set[str], phrases: set[str]) -> bool:
    text = " ".join(words(specialty))
    if any(p in text for p in phrases):
        return True
    for w in words(specialty):
        r = root(w)
        for n in roots:
            if r == n or (len(n) >= 4 and w.startswith(n)):  # "neur" finds "Neurosurgeon"
                return True
            # Typo tolerance only for medical-looking words: some websites put other text in the specialty
            # field ("Rajan Eye Care"), and the name "Raman" must not count as a typo of "Rajan".
            if (w.endswith(_MEDICAL_ENDINGS) and min(len(n), len(r)) >= _FUZZY_MIN - 1
                    and SequenceMatcher(None, r, n).ratio() >= _SIMILAR):
                return True
    return False


_SPECIALTY_WORD = ("ologist", "ologists", "ology", "ological", "ician", "icians", "ist", "ists", "ics")


def name_words(query: str) -> str:
    """The query without specialty words, for the doctor-NAME typo check. Some websites put the specialty
    in the name ("Dr. Ravi Shankar Ophthalmologist"), and "urologist" must not match it by its ending."""
    return " ".join(w for w in words(query) if not w.endswith(_SPECIALTY_WORD))


def matching_specialties(query: str, specialties) -> list[str]:
    """The distinct specialty strings (from the database) that fit the patient's query."""
    roots, phrases = needles(query)
    return [s for s in specialties if s and specialty_matches(s, roots, phrases)]
