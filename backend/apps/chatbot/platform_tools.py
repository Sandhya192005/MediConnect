"""
Chatbot tools for the MediConnect PLATFORM ADMIN (phase 3, owner request 2026-11-26). Read-only. Numbers come
from analytics/services.py, the same code as the platform dashboard and Reports & analytics, so they agree.
Each tool checks again that the user is the platform admin (superuser), on top of the role's tool list.
"""

from django.utils import timezone

from apps.accounts.permissions import is_platform_admin

NOT_ADMIN = {"error": "Only the MediConnect platform admin can see this."}

SPECS = [
    {
        "type": "function",
        "function": {
            "name": "platform_summary",
            "description": "MediConnect's totals with this month's growth: hospital accounts, connected hospitals (bookable, not connected), patients, doctors, appointments booked this month; and how many connection requests, support messages and website appointment requests are waiting.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "platform_growth",
            "description": "Month by month (default the last 6 months): new patients, new doctors, new connected hospitals, appointments booked and completed, records uploaded.",
            "parameters": {
                "type": "object",
                "properties": {"months": {"type": "integer", "description": "How many months back, 3 to 12"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "connection_requests_waiting",
            "description": "Hospitals waiting for the platform admin to approve or decline their request to connect.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "support_messages_open",
            "description": "Open messages in the Support inbox: who sent them (patient, doctor or hospital), topic, subject, when.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "website_requests_waiting",
            "description": "Patients' appointment requests for website (not connected) hospitals that the platform admin still has to confirm or decline.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def _date(dt):
    return timezone.localtime(dt).strftime("%a %d %b %Y")


def platform_summary(ctx):
    from apps.analytics.services import overview
    from apps.appointments.models import AppointmentRequest
    from apps.hospitals.models import ConnectionRequest
    from apps.support.models import SupportRequest

    if not is_platform_admin(ctx.user):
        return NOT_ADMIN
    o = overview()
    return {
        "hospital_accounts": o["hospital_accounts"], "connected_hospitals": o["hospitals"],
        "patients": o["patients"], "doctors": o["doctors"], "appointments": o["appointments"],
        "waiting_for_you": {
            "connection_requests": ConnectionRequest.objects.filter(status="pending").count(),
            "open_support_messages": SupportRequest.objects.filter(status="open").count(),
            "website_appointment_requests": AppointmentRequest.objects.filter(for_hospital=False, status="pending").count(),
        },
        "note": "change_pct compares with the start of this month; null means there was nothing to compare with.",
    }


def platform_growth(ctx, months: int = 6):
    from apps.analytics.services import reports

    if not is_platform_admin(ctx.user):
        return NOT_ADMIN
    months = min(max(int(months or 6), 3), 12)
    r = reports(months)
    usage, growth = r["usage"], r["growth"]
    return {"months": [
        {"month": m, "new_patients": usage["new_patients"][i], "new_doctors": usage["new_doctors"][i],
         "new_connected_hospitals": growth["new_hospitals"][i], "appointments_booked": usage["appointments_booked"][i],
         "appointments_completed": usage["appointments_completed"][i], "records_uploaded": usage["records_uploaded"][i]}
        for i, m in enumerate(r["months"])
    ]}


def connection_requests_waiting(ctx):
    from apps.hospitals.models import ConnectionRequest

    if not is_platform_admin(ctx.user):
        return NOT_ADMIN
    rows = ConnectionRequest.objects.filter(status="pending").select_related("hospital").order_by("created_at")[:15]
    return {"waiting": [{"hospital": r.hospital.name, "city": r.hospital.city, "message": r.message,
                         "asked_on": _date(r.created_at), "where": "Connection requests"} for r in rows]}


def support_messages_open(ctx):
    from apps.support.models import SupportRequest

    if not is_platform_admin(ctx.user):
        return NOT_ADMIN
    rows = SupportRequest.objects.filter(status="open").select_related("user").order_by("created_at")[:15]
    return {"open": [{"from": r.user.get_full_name() or "A user", "account": r.user.role, "topic": r.get_topic_display(),
                      "subject": r.subject, "sent_on": _date(r.created_at), "where": "Support inbox"} for r in rows]}


def website_requests_waiting(ctx):
    from apps.appointments.models import AppointmentRequest

    if not is_platform_admin(ctx.user):
        return NOT_ADMIN
    rows = (AppointmentRequest.objects.filter(for_hospital=False, status="pending")
            .select_related("hospital", "patient", "scraped_doctor").order_by("preferred_date")[:15])
    return {"waiting": [{"patient": r.patient.get_full_name() or "Patient", "hospital": r.hospital.name,
                         "doctor": r.scraped_doctor.name if r.scraped_doctor else "any doctor",
                         "preferred": f"{r.preferred_date:%a %d %b}, {r.preferred_time or 'any time'}",
                         "where": "Appointment requests"} for r in rows]}


REGISTRY = {
    "platform_summary": platform_summary,
    "platform_growth": platform_growth,
    "connection_requests_waiting": connection_requests_waiting,
    "support_messages_open": support_messages_open,
    "website_requests_waiting": website_requests_waiting,
}
