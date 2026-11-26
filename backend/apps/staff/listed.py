"""
Doctors a connected hospital added in Doctor management, shown to patients (owner request 2026-11-26:
"all the doctors should be listed whether they have a doctor account in MediConnect or not").

A doctor here is one of two kinds, and patients always see which:
  - bookable: a MediConnect doctor account with working hours (free slots, instant booking), as before;
  - listed by the hospital: a staff record only (no account, or an account without working hours).
    Shown with a "not bookable online" label; never given slots.

Only safe, professional details leave this module: name, specialty, department, qualification and
designation. Phone, email, salary and dates stay inside the hospital's own pages.
"""

import re

from django.db.models import Q

from apps.doctors.models import DoctorProfile

from .models import StaffMember


def _bookable_profile_ids():
    return DoctorProfile.objects.filter(is_active=True, hospital__is_approved=True,
                                        availability__isnull=False).values("id")


def listed_doctors():
    """Working doctors of connected hospitals who can't be booked online."""
    return (
        StaffMember.objects.active()
        .filter(kind=StaffMember.Kind.DOCTOR, hospital__is_approved=True)
        .exclude(doctor__in=_bookable_profile_ids())
        .select_related("hospital", "department", "doctor")
    )


def display_name(s: StaffMember) -> str:
    """Without a leading "Dr." (pages add it), so "Dr. Shiva" and "Shiva" look the same."""
    return re.sub(r"^\s*dr\.?\s+", "", s.full_name, flags=re.IGNORECASE).strip() or s.full_name


def specialization(s: StaffMember) -> str:
    return s.specialization or (s.doctor.specialization if s.doctor else "")


def specialty(s: StaffMember) -> str:
    """The group a patient browses by, like DoctorProfile's: department, else specialization."""
    return s.department.name if s.department else (specialization(s) or "General")


def public(s: StaffMember) -> dict:
    return {
        "id": s.id, "name": display_name(s), "specialization": specialization(s), "department": specialty(s),
        "qualification": s.qualification, "designation": s.designation, "bookable": False,
    }


def matches(s: StaffMember, q: str) -> bool:
    """The patient's search fits this doctor: name, or specialty (word roots, everyday words, typos)."""
    from apps.search.specialties import matching_specialties

    if q.lower() in s.full_name.lower():
        return True
    texts = [specialization(s), specialty(s)]
    if any(re.search(r"(^|[^a-z])" + re.escape(q.lower()), t.lower()) for t in texts if t):
        return True
    return bool(matching_specialties(q, texts))


def name_or_city_match(hospital, q: str) -> bool:
    text = f"{hospital.name} {hospital.city}".lower()
    return all(w in text for w in q.lower().split())


def for_hospital(hospital) -> list[dict]:
    if not hospital.is_approved:
        return []
    return [public(s) for s in listed_doctors().filter(hospital=hospital).filter(~Q(full_name=""))]
