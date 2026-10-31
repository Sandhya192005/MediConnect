"""
Tools the assistant can call. The model never touches the database itself: it asks for a
tool by name with JSON arguments, we run our own trusted code, and send back the result.

The assistant can NOT book. `propose_booking` only checks the slot and returns a card;
the patient books by pressing "Confirm" in the UI, which calls the normal booking API.
"""

import json
from datetime import datetime, timedelta

from django.db.models import Q
from django.utils import timezone
from elasticsearch import ApiError, ConnectionError as ESConnectionError

from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile
from apps.doctors.services import cached_slots, is_slot_available
from apps.hospitals.models import Hospital
from apps.hospitals.services import nearby_hospitals

# JSON-schema descriptions the model reads to decide which tool to call.
TOOL_SPECS = [
    {
        "type": "function",
        "function": {
            "name": "search_doctors",
            "description": "Find bookable doctors by specialty, symptom area, name or hospital. Use everyday words too (e.g. 'heart', 'skin', 'kids').",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "What to search for, e.g. 'cardiologist' or 'skin'"},
                    "city": {"type": "string", "description": "City name, e.g. 'Chennai'"},
                    "max_fee": {"type": "number", "description": "Maximum consultation fee in rupees"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_available_slots",
            "description": "List free appointment times for one doctor on one date.",
            "parameters": {
                "type": "object",
                "properties": {
                    "doctor_id": {"type": "integer"},
                    "date": {"type": "string", "description": "YYYY-MM-DD, today or within the next 30 days"},
                },
                "required": ["doctor_id", "date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_hospitals",
            "description": "Find hospitals near the user's shared location, or in a city. Use the user's location automatically if they shared it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "City to browse, if the user named one"},
                    "radius_km": {"type": "number", "description": "Search radius for nearby search, 1-50 (default 10)"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "my_appointments",
            "description": "The current user's own appointments.",
            "parameters": {
                "type": "object",
                "properties": {"when": {"type": "string", "enum": ["upcoming", "past"]}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_booking",
            "description": (
                "Check that a slot is still free and show the user a booking card with a Confirm button. "
                "This does NOT book: the user must press Confirm. Only call it after the user chose a doctor and time."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "doctor_id": {"type": "integer"},
                    "start": {"type": "string", "description": "Slot start exactly as returned by get_available_slots"},
                    "reason": {"type": "string", "description": "Short reason for the visit, if the user gave one"},
                },
                "required": ["doctor_id", "start"],
            },
        },
    },
]


class ToolContext:
    """What a tool may know about the current request."""

    def __init__(self, user, location=None):
        self.user = user
        self.location = location  # {"lat": .., "lng": ..} only if the user chose to share it
        self.proposals: list[dict] = []


def _fmt(dt) -> str:
    return timezone.localtime(dt).strftime("%a %d %b %Y, %I:%M %p")


def _doctor_card(d: DoctorProfile) -> dict:
    return {
        "doctor_id": d.id,
        "name": f"Dr. {d.user.get_full_name() or d.user.email}",
        "specialization": d.specialization,
        "hospital": d.hospital.name if d.hospital else None,
        "city": d.hospital.city if d.hospital else None,
        "fee": float(d.fee),
        "experience_years": d.experience_years,
    }


def search_doctors(ctx, query: str, city: str | None = None, max_fee: float | None = None):
    try:
        from apps.search.queries import search_doctors as es_search

        hits = es_search(query, city=city, max_fee=max_fee, size=8)["results"]
        ids = [h["id"] for h in hits]
        by_id = {d.id: d for d in DoctorProfile.objects.select_related("user", "hospital").filter(id__in=ids)}
        doctors = [by_id[i] for i in ids if i in by_id]
    except (ESConnectionError, ApiError):
        # Search engine down: fall back to a simple database search.
        qs = DoctorProfile.objects.select_related("user", "hospital").filter(
            is_active=True, hospital__is_approved=True
        ).filter(
            Q(specialization__icontains=query) | Q(user__first_name__icontains=query)
            | Q(user__last_name__icontains=query) | Q(department__name__icontains=query)
            | Q(hospital__name__icontains=query)
        )
        if city:
            qs = qs.filter(hospital__city__iexact=city)
        if max_fee is not None:
            qs = qs.filter(fee__lte=max_fee)
        doctors = list(qs[:8])
    return {"doctors": [_doctor_card(d) for d in doctors if d.is_bookable]}


def get_available_slots(ctx, doctor_id: int, date: str):
    try:
        day = datetime.strptime(date, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return {"error": "Date must be YYYY-MM-DD."}
    today = timezone.localdate()
    if not (today <= day <= today + timedelta(days=30)):
        return {"error": "Pick a date between today and 30 days from now."}
    doctor = DoctorProfile.objects.select_related("user", "hospital").filter(pk=doctor_id).first()
    if not doctor or not doctor.is_bookable:
        return {"error": "That doctor isn't taking bookings."}
    free = [s for s in cached_slots(doctor, day) if s["available"]]
    return {
        "doctor": _doctor_card(doctor)["name"],
        "date": day.isoformat(),
        "free_slots": [{"start": s["start"].isoformat(), "time": timezone.localtime(s["start"]).strftime("%I:%M %p")} for s in free[:24]],
        "total_free": len(free),
    }


def find_hospitals(ctx, city: str | None = None, radius_km: float = 10):
    if ctx.location and not city:
        radius = min(max(float(radius_km or 10), 1), 50)
        rows = nearby_hospitals(ctx.location["lat"], ctx.location["lng"], radius, limit=8)
        return {
            "near_user": True,
            "radius_km": radius,
            "hospitals": [
                {"hospital_id": h.id, "name": h.name, "city": h.city, "distance_km": round(h.distance.km, 1),
                 "doctors": h.doctor_count, "location_verified": h.location_verified}
                for h in rows
            ],
        }
    if city:
        rows = Hospital.objects.filter(is_approved=True, city__iexact=city)[:8]
        return {"city": city, "hospitals": [{"hospital_id": h.id, "name": h.name, "address": h.address} for h in rows]}
    return {"error": "Ask the user for a city, or to tap 'Share my location' in the chat."}


def my_appointments(ctx, when: str = "upcoming"):
    qs = Appointment.objects.select_related("doctor__user", "doctor__hospital")
    qs = qs.filter(doctor__user=ctx.user) if ctx.user.role == "doctor" else qs.filter(patient=ctx.user)
    now = timezone.now()
    qs = qs.filter(start__gte=now).order_by("start") if when != "past" else qs.filter(start__lt=now).order_by("-start")
    return {"appointments": [
        {"id": a.id, "doctor": str(a.doctor), "hospital": a.doctor.hospital.name if a.doctor.hospital else None,
         "when": _fmt(a.start), "status": a.status}
        for a in qs[:10]
    ]}


def propose_booking(ctx, doctor_id: int, start: str, reason: str = ""):
    if ctx.user.role != "patient":
        return {"error": "Only patient accounts can book appointments."}
    try:
        start_dt = datetime.fromisoformat(start)
    except (TypeError, ValueError):
        return {"error": "Use the exact slot start from get_available_slots."}
    if timezone.is_naive(start_dt):
        start_dt = timezone.make_aware(start_dt)
    doctor = DoctorProfile.objects.select_related("user", "hospital").filter(pk=doctor_id).first()
    if not doctor or not doctor.is_bookable:
        return {"error": "That doctor isn't taking bookings."}
    if not is_slot_available(doctor, start_dt):
        return {"error": "That slot is no longer free. Offer other times."}

    card = {
        **_doctor_card(doctor),
        "start": timezone.localtime(start_dt).isoformat(),
        "when": _fmt(start_dt),
        "reason": (reason or "")[:300],
    }
    ctx.proposals.append(card)
    return {"status": "shown_to_user", "note": "The user must press Confirm on the card to book. Nothing is booked yet."}


REGISTRY = {
    "search_doctors": search_doctors,
    "get_available_slots": get_available_slots,
    "find_hospitals": find_hospitals,
    "my_appointments": my_appointments,
    "propose_booking": propose_booking,
}


def run_tool(ctx: ToolContext, name: str, arguments: str) -> str:
    """Run one tool safely and return its result as a JSON string for the model."""
    fn = REGISTRY.get(name)
    if fn is None:
        return json.dumps({"error": f"Unknown tool {name}"})
    try:
        args = json.loads(arguments or "{}")
        if not isinstance(args, dict):
            raise ValueError
    except ValueError:
        return json.dumps({"error": "Arguments must be a JSON object."})
    try:
        result = fn(ctx, **args)
    except TypeError:
        result = {"error": "Wrong arguments for this tool."}
    return json.dumps(result, default=str)[:6000]


__all__ = ["TOOL_SPECS", "ToolContext", "run_tool"]
