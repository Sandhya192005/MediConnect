"""
Tools the assistant can call. The model never touches the database itself: it asks for a
tool by name with JSON arguments, we run our own trusted code, and send back the result.

Each role gets its own tools (roles.py, owner request 2026-11-26): the chat loop offers only those, and
run_tool refuses the rest. Every tool reads only what that user may see in the app. All are read-only.

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
    # --- Patient (2026-11-26) ---
    {
        "type": "function",
        "function": {
            "name": "my_requests",
            "description": "The patient's appointment requests (doctors without online booking, website hospitals): status, the doctor, the confirmed time or the reason for a decline.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "my_payments",
            "description": "The patient's payment slips from hospitals: pending and paid totals and each slip.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    # --- Doctor (2026-11-26) ---
    {
        "type": "function",
        "function": {
            "name": "my_schedule",
            "description": "The doctor's appointments on one day (default today) with the queue: who is waiting (by token), in consultation, not arrived, done, missed.",
            "parameters": {
                "type": "object",
                "properties": {"date": {"type": "string", "description": "YYYY-MM-DD; leave out for today"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "requests_waiting_for_me",
            "description": "Booking requests waiting for the doctor's Accept or Reject.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "my_working_hours",
            "description": "The doctor's weekly working hours (duty schedule), slot length and fee.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


from . import hospital_tools, platform_tools  # noqa: E402  (phase 2: hospital accounts; phase 3: platform admin)

TOOL_SPECS += hospital_tools.SPECS + platform_tools.SPECS


def specs_for(role: str) -> list[dict]:
    """The tool descriptions offered to the model for this role (roles.TOOLS)."""
    from .roles import tools_for

    allowed = set(tools_for(role))
    return [t for t in TOOL_SPECS if t["function"]["name"] in allowed]


class ToolContext:
    """What a tool may know about the current request."""

    def __init__(self, user, location=None):
        from .roles import role_of

        self.user = user
        self.role = role_of(user)
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
    return {
        "doctors": [_doctor_card(d) for d in doctors if d.is_bookable],
        "listed_by_hospital_not_bookable_online": _listed_doctors(query, city),
    }


def _listed_doctors(query: str, city: str | None) -> list[dict]:
    """Doctors a connected hospital added itself (no online booking): the patient sends a request instead."""
    from apps.staff.listed import display_name, listed_doctors, matches, specialty

    qs = listed_doctors()
    if city:
        qs = qs.filter(hospital__city__iexact=city)
    found = [s for s in qs if matches(s, query)][:5]
    return [{"name": f"Dr. {display_name(s)}", "specialty": specialty(s), "qualification": s.qualification,
             "hospital": s.hospital.name, "hospital_id": s.hospital_id,
             "how_to_book": "Open the hospital's page and press Request appointment; the hospital confirms a time."}
            for s in found]


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
                 "mediconnect_partner_instant_booking": h.partner, "location_verified": h.location_verified}
                for h in rows
            ],
        }
    if city:
        rows = Hospital.objects.filter(is_approved=True, city__iexact=city)[:8]
        return {"city": city, "hospitals": [{"hospital_id": h.id, "name": h.name, "address": h.address} for h in rows]}
    return {"error": "Ask the user for a city, or to tap 'Share my location' in the chat."}


def my_appointments(ctx, when: str = "upcoming"):
    qs = Appointment.objects.select_related("doctor__user", "doctor__hospital")
    if ctx.role == "doctor":  # like the app: requests the hospital hasn't passed on yet stay hidden
        qs = qs.filter(doctor__user=ctx.user, awaiting_hospital=False)
    else:
        qs = qs.filter(patient=ctx.user)
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


# ---- Patient (2026-11-26) ---------------------------------------------------------------------------

def my_requests(ctx):
    from apps.appointments.models import AppointmentRequest
    from apps.appointments.requests_api import AppointmentRequestSerializer

    rows = AppointmentRequest.objects.filter(patient=ctx.user).select_related(
        "hospital", "scraped_doctor", "patient", "staff_doctor__department", "assigned_doctor__department")[:10]
    data = AppointmentRequestSerializer(rows, many=True).data
    keep = ["hospital_name", "doctor_name", "doctor_department", "status_label", "preferred_date", "preferred_time",
            "assigned_doctor_name", "assigned_department", "confirmed_date", "confirmed_time", "admin_note"]
    return {"requests": [{k: r[k] for k in keep if r.get(k)} for r in data]}


def my_payments(ctx):
    from apps.billing.models import PaymentSlip

    slips = list(PaymentSlip.objects.filter(patient=ctx.user).select_related("hospital").order_by("-issued_on")[:20])

    def total(status):
        return float(sum(s.total for s in slips if s.status == status))

    return {
        "pending_total_rupees": total("pending"), "paid_total_rupees": total("completed"),
        "slips": [{"number": s.number, "hospital": s.hospital.name, "date": s.issued_on.isoformat(),
                   "total_rupees": float(s.total), "status": s.get_status_display()} for s in slips],
    }


# ---- Doctor (2026-11-26) ----------------------------------------------------------------------------

def _my_profile(ctx):
    return DoctorProfile.objects.filter(user=ctx.user).select_related("hospital").first()


def my_schedule(ctx, date: str | None = None):
    from apps.appointments.queue import appointments_on

    doctor = _my_profile(ctx)
    if not doctor:
        return {"error": "No doctor profile for this account."}
    try:
        day = datetime.strptime(date, "%Y-%m-%d").date() if date else timezone.localdate()
    except ValueError:
        return {"error": "Date must be YYYY-MM-DD."}
    visits = list(appointments_on(doctor.id, day).exclude(status=Appointment.Status.CANCELLED)
                  .select_related("patient__patient_profile").order_by("start"))
    rows = [{"time": timezone.localtime(a.start).strftime("%I:%M %p"), "patient": a.patient.get_full_name() or "Patient",
             "patient_id": getattr(getattr(a.patient, "patient_profile", None), "patient_id", None),
             "queue": a.queue_status, "token": a.token, "reason": a.reason} for a in visits]
    waiting = sorted((r for r in rows if r["queue"] == "waiting"), key=lambda r: r["token"] or 0)
    return {
        "date": day.isoformat(), "total": len(rows),
        "counts": {q: sum(r["queue"] == q for r in rows)
                   for q in ("not_arrived", "waiting", "in_consultation", "done", "no_show")},
        "next_patient": waiting[0] if waiting else None,
        "appointments": rows,
    }


def requests_waiting_for_me(ctx):
    rows = (Appointment.objects.filter(doctor__user=ctx.user, awaiting_doctor=True, awaiting_hospital=False,
                                       status=Appointment.Status.BOOKED, start__gte=timezone.now())
            .select_related("patient").order_by("start")[:10])
    return {"waiting_for_you": [
        {"patient": a.patient.get_full_name() or "Patient", "when": _fmt(a.start), "reason": a.reason,
         "where_to_answer": "Appointments, Accept or Reject"} for a in rows
    ]}


def my_working_hours(ctx):
    from apps.doctors.models import WeeklyAvailability

    doctor = _my_profile(ctx)
    if not doctor:
        return {"error": "No doctor profile for this account."}
    hours = WeeklyAvailability.objects.filter(doctor=doctor)
    return {
        "hospital": doctor.hospital.name if doctor.hospital else None,
        "slot_minutes": doctor.slot_minutes, "fee_rupees": float(doctor.fee),
        "weekly_hours": [{"day": h.get_weekday_display(), "from": h.start_time.strftime("%I:%M %p"),
                          "to": h.end_time.strftime("%I:%M %p")} for h in hours],
        "patients_can_book_you": doctor.is_bookable,
    }


REGISTRY = {
    "search_doctors": search_doctors,
    "get_available_slots": get_available_slots,
    "find_hospitals": find_hospitals,
    "my_appointments": my_appointments,
    "propose_booking": propose_booking,
    "my_requests": my_requests,
    "my_payments": my_payments,
    "my_schedule": my_schedule,
    "requests_waiting_for_me": requests_waiting_for_me,
    "my_working_hours": my_working_hours,
    **hospital_tools.REGISTRY,
    **platform_tools.REGISTRY,
}


def run_tool(ctx: ToolContext, name: str, arguments: str) -> str:
    """Run one tool safely and return its result as a JSON string for the model."""
    from .roles import tools_for

    fn = REGISTRY.get(name)
    if fn is None:
        return json.dumps({"error": f"Unknown tool {name}"})
    if name not in tools_for(ctx.role):  # never trust the model to pick only the tools it was offered
        return json.dumps({"error": f"The tool {name} isn't available for this account."})
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


__all__ = ["TOOL_SPECS", "ToolContext", "run_tool", "specs_for"]
