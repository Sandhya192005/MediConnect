"""
Chatbot tools for a HOSPITAL account (phase 2, owner request 2026-11-26). Read-only, and always limited to
the account's own hospital (`admin_hospital`), like every /api/hospital-admin/ page. Counts are made the
same way as the hospital dashboard (staff/views.OverviewView), so the chat and the dashboard agree.
"""

from datetime import datetime

from django.db.models import Count, Sum
from django.utils import timezone

from apps.accounts.permissions import admin_hospital
from apps.appointments.models import ACTIVE_STATUSES, Appointment, AppointmentRequest
from apps.appointments.queue import day_bounds

NO_HOSPITAL = {"error": "This account isn't linked to a hospital."}

SPECS = [
    {
        "type": "function",
        "function": {
            "name": "hospital_summary",
            "description": "The hospital's numbers right now, as on its dashboard: doctors, nurses and other staff working, patients, today's appointments, patients waiting now, bookings to assign, bookings waiting for doctors, requests for hospital-added doctors, monthly payroll.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "hospital_appointments",
            "description": "The hospital's appointments on one day (default today): time, doctor, patient and status, with counts per status and per doctor.",
            "parameters": {
                "type": "object",
                "properties": {"date": {"type": "string", "description": "YYYY-MM-DD; leave out for today"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "hospital_requests_waiting",
            "description": "Everything waiting for the hospital or its doctors: bookings to assign, bookings waiting for a doctor's answer, and appointment requests for doctors the hospital added itself.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "hospital_doctors",
            "description": "The hospital's working doctors with department, whether patients can book them online, their working hours on a day (default today) and how many appointments they have that day.",
            "parameters": {
                "type": "object",
                "properties": {"date": {"type": "string", "description": "YYYY-MM-DD; leave out for today"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "hospital_payments",
            "description": "The hospital's payment slips: pending total and count, paid this month, and the latest unpaid slips with patient and amount.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def _day(date):
    return datetime.strptime(date, "%Y-%m-%d").date() if date else timezone.localdate()


def _time(dt):
    return timezone.localtime(dt).strftime("%I:%M %p")


def _when(dt):
    return timezone.localtime(dt).strftime("%a %d %b, %I:%M %p")


def _status(a: Appointment) -> str:
    if a.awaiting_hospital and a.status == Appointment.Status.BOOKED:
        return "to assign (waiting for the hospital)"
    if a.awaiting_doctor and a.status == Appointment.Status.BOOKED:
        return "waiting for the doctor's answer"
    if a.status in ACTIVE_STATUSES:
        return {"in_consultation": "in consultation", "waiting": "checked in, waiting",
                "not_arrived": "not arrived"}.get(a.queue_status, a.get_status_display())
    return a.get_status_display()


def hospital_summary(ctx):
    from apps.staff.models import StaffMember
    from apps.staff.views import OTHER_STAFF_KINDS, hospital_patients

    hospital = admin_hospital(ctx.user)
    if not hospital:
        return NO_HOSPITAL
    active = StaffMember.objects.filter(hospital=hospital).active()
    start, end = day_bounds()
    todays = Appointment.objects.filter(doctor__hospital=hospital, start__gte=start, start__lt=end)
    booked = Appointment.objects.filter(doctor__hospital=hospital, status=Appointment.Status.BOOKED)
    return {
        "hospital": hospital.name, "connected_to_mediconnect": hospital.is_approved,
        "doctors": active.filter(kind="doctor").count(),
        "nurses": active.filter(kind="nurse").count(),
        "other_staff": active.filter(kind__in=OTHER_STAFF_KINDS).count(),
        "patients": hospital_patients(hospital).count(),
        "appointments_today": todays.exclude(status="cancelled").count(),
        "patients_waiting_now": todays.filter(status__in=ACTIVE_STATUSES, checked_in_at__isnull=False,
                                              consultation_started_at__isnull=True).count(),
        "bookings_to_assign": booked.filter(awaiting_hospital=True).count(),
        "bookings_waiting_for_doctors": booked.filter(awaiting_doctor=True).count(),
        "requests_for_hospital_added_doctors": AppointmentRequest.objects.filter(
            hospital=hospital, for_hospital=True, status="pending").count(),
        "monthly_payroll_rupees": float(active.aggregate(t=Sum("monthly_salary"))["t"] or 0),
    }


def hospital_appointments(ctx, date: str | None = None):
    hospital = admin_hospital(ctx.user)
    if not hospital:
        return NO_HOSPITAL
    try:
        day = _day(date)
    except ValueError:
        return {"error": "Date must be YYYY-MM-DD."}
    start, end = day_bounds(day)
    rows = list(Appointment.objects.filter(doctor__hospital=hospital, start__gte=start, start__lt=end)
                .select_related("doctor__user", "patient").order_by("start"))
    shown = [a for a in rows if a.status != Appointment.Status.CANCELLED]
    per_doctor = {}
    for a in shown:
        per_doctor[str(a.doctor)] = per_doctor.get(str(a.doctor), 0) + 1
    statuses = {}
    for a in shown:
        statuses[_status(a)] = statuses.get(_status(a), 0) + 1
    return {
        "date": day.isoformat(), "total": len(shown), "cancelled": len(rows) - len(shown),
        "by_status": statuses, "by_doctor": per_doctor,
        "appointments": [{"time": _time(a.start), "doctor": str(a.doctor), "patient": a.patient.get_full_name() or "Patient",
                          "status": _status(a)} for a in shown[:30]],
    }


def hospital_requests_waiting(ctx):
    from apps.staff.listed import display_name

    hospital = admin_hospital(ctx.user)
    if not hospital:
        return NO_HOSPITAL
    booked = (Appointment.objects.filter(doctor__hospital=hospital, status=Appointment.Status.BOOKED,
                                         start__gte=timezone.now())
              .select_related("doctor__user", "patient").order_by("start"))
    requests = (AppointmentRequest.objects.filter(hospital=hospital, for_hospital=True, status="pending")
                .select_related("patient", "staff_doctor").order_by("preferred_date"))
    return {
        "to_assign": [{"patient": a.patient.get_full_name() or "Patient", "doctor_chosen": str(a.doctor),
                       "when": _when(a.start), "where": "Appointments, To assign"}
                      for a in booked.filter(awaiting_hospital=True)[:10]],
        "waiting_for_doctors": [{"patient": a.patient.get_full_name() or "Patient", "doctor": str(a.doctor),
                                 "when": _when(a.start)} for a in booked.filter(awaiting_doctor=True)[:10]],
        "requests_for_hospital_added_doctors": [
            {"patient": r.patient.get_full_name() or "Patient",
             "doctor": f"Dr. {display_name(r.staff_doctor)}" if r.staff_doctor else None,
             "preferred": f"{r.preferred_date:%a %d %b}, {r.preferred_time or 'any time'}",
             "where": "Appointments, Appointment requests box"} for r in requests[:10]],
    }


def hospital_doctors(ctx, date: str | None = None):
    from apps.doctors.models import DoctorProfile, WeeklyAvailability
    from apps.staff.listed import display_name, specialty
    from apps.staff.models import StaffMember

    hospital = admin_hospital(ctx.user)
    if not hospital:
        return NO_HOSPITAL
    try:
        day = _day(date)
    except ValueError:
        return {"error": "Date must be YYYY-MM-DD."}
    start, end = day_bounds(day)
    visits = dict(Appointment.objects.filter(doctor__hospital=hospital, start__gte=start, start__lt=end)
                  .exclude(status="cancelled").values("doctor_id").annotate(n=Count("id")).values_list("doctor_id", "n"))
    staff = list(StaffMember.objects.active(on=day).filter(hospital=hospital, kind="doctor")
                 .select_related("department", "doctor"))
    linked = {s.doctor_id for s in staff if s.doctor_id}
    # Doctor accounts at this hospital that have no staff record yet are its doctors too.
    accounts = DoctorProfile.objects.filter(hospital=hospital, is_active=True).exclude(id__in=linked).select_related("user", "department")
    hours = {}
    for h in WeeklyAvailability.objects.filter(doctor__hospital=hospital, weekday=day.weekday()):
        hours.setdefault(h.doctor_id, []).append(f"{h.start_time:%I:%M %p}–{h.end_time:%I:%M %p}")

    def row(name, dept, profile):
        return {"name": f"Dr. {name}", "department": dept,
                "bookable_online": bool(profile and profile.is_bookable),
                "hours_that_day": hours.get(profile.id, []) if profile else "not in MediConnect (added by the hospital)",
                "appointments_that_day": visits.get(profile.id, 0) if profile else 0}

    doctors = [row(display_name(s), specialty(s), s.doctor) for s in staff]
    doctors += [row(d.user.get_full_name() or d.user.email,
                    d.department.name if d.department else (d.specialization or "General"), d) for d in accounts]
    on_duty = [d["name"] for d in doctors if isinstance(d["hours_that_day"], list) and d["hours_that_day"]]
    return {"date": day.isoformat(), "doctors": doctors, "on_duty_that_day": on_duty}


def hospital_payments(ctx):
    from apps.billing.models import PaymentSlip

    hospital = admin_hospital(ctx.user)
    if not hospital:
        return NO_HOSPITAL
    slips = PaymentSlip.objects.filter(hospital=hospital)
    pending = slips.filter(status="pending")
    month_start = timezone.localdate().replace(day=1)
    return {
        "pending_total_rupees": float(pending.aggregate(t=Sum("total"))["t"] or 0),
        "pending_slips": pending.count(),
        "paid_this_month_rupees": float(slips.filter(status="completed", paid_on__gte=month_start)
                                        .aggregate(t=Sum("total"))["t"] or 0),
        "latest_unpaid": [{"patient": s.patient.get_full_name() or "Patient", "number": s.number,
                           "date": s.issued_on.isoformat(), "amount_rupees": float(s.total)}
                          for s in pending.select_related("patient").order_by("-issued_on")[:10]],
    }


REGISTRY = {
    "hospital_summary": hospital_summary,
    "hospital_appointments": hospital_appointments,
    "hospital_requests_waiting": hospital_requests_waiting,
    "hospital_doctors": hospital_doctors,
    "hospital_payments": hospital_payments,
}
