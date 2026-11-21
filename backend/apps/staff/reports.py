"""
Reports for ONE hospital (owner request 2026-11-20), shown on the hospital account's Reports page.

Everything is counted from the hospital's real appointments; nothing is stored separately.
Definitions (also shown on the page):
- an appointment belongs to the month of its visit date (`start`), so the current month also counts
  visits booked for later this month;
- "appointments" = not cancelled (booked, confirmed, completed or no-show);
- a NO-SHOW is a visit the doctor or hospital marked "didn't come" (by hand, since 2026-11-20);
  older missed visits were auto-completed and can't be told apart;
- a NEW patient in a month = their first VISIT at this hospital (not cancelled, not a no-show) is in
  that month; a RETURNING patient had an earlier visit here;
- cancellations are split by who cancelled: the patient, the doctor, or the hospital (declined).
"""

from datetime import date

from django.db.models import Count, Q
from django.utils import timezone

from apps.analytics.services import aware, month_starts
from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile

CANCELLED = Appointment.Status.CANCELLED
COMPLETED = Appointment.Status.COMPLETED
NO_SHOW = Appointment.Status.NO_SHOW
NOT_VISITS = (CANCELLED, NO_SHOW)  # the patient wasn't seen
ACTIVE = (Appointment.Status.BOOKED, Appointment.Status.CONFIRMED)
# Who declined/cancelled for the hospital ("admin" = hospital logins before the hospital role, 2026-11-19).
BY_HOSPITAL = ("hospital", "admin")


def _next_month(d: date) -> date:
    return date(d.year + 1, 1, 1) if d.month == 12 else date(d.year, d.month + 1, 1)


def hospital_reports(hospital, months_back: int = 12, today: date | None = None) -> dict:
    months = month_starts(months_back, today)
    start, end = aware(months[0]), aware(_next_month(months[-1]))
    here = Appointment.objects.filter(doctor__hospital=hospital)
    period = here.filter(start__gte=start, start__lt=end)
    index = {m: i for i, m in enumerate(months)}

    def month_of(dt) -> date:
        return timezone.localtime(dt).date().replace(day=1)

    # ---- Appointments per month ----
    booked, completed, no_show = [0] * len(months), [0] * len(months), [0] * len(months)
    for status, when in period.exclude(status=CANCELLED).values_list("status", "start"):
        i = index[month_of(when)]
        booked[i] += 1
        if status == COMPLETED:
            completed[i] += 1
        elif status == NO_SHOW:
            no_show[i] += 1

    cancelled = period.filter(status=CANCELLED)
    totals = {
        "appointments": sum(booked),
        "completed": sum(completed),
        "no_show": sum(no_show),
        "upcoming": period.filter(status__in=ACTIVE, start__gte=timezone.now()).count(),
        "cancelled_by_patient": cancelled.filter(cancelled_by="patient").count(),
        "cancelled_by_doctor": cancelled.filter(cancelled_by="doctor").count(),
        "declined_by_hospital": cancelled.filter(cancelled_by__in=BY_HOSPITAL).count(),
    }

    # ---- Patients per month: new vs returning ----
    first_visit: dict[int, date] = {}
    visits_in: list[set[int]] = [set() for _ in months]
    for patient_id, when in here.exclude(status__in=NOT_VISITS).filter(start__lt=end).order_by("start").values_list("patient_id", "start"):
        m = month_of(when)
        first_visit.setdefault(patient_id, m)  # ordered by start, so the first one seen is the earliest
        if m in index:
            visits_in[index[m]].add(patient_id)
    new = [sum(1 for p in seen if first_visit[p] == months[i]) for i, seen in enumerate(visits_in)]
    returning = [len(seen) - n for seen, n in zip(visits_in, new)]
    patients = {
        "new": new,
        "returning": returning,
        "unique": len(set().union(*visits_in)) if visits_in else 0,
        "new_total": sum(new),
    }

    # ---- Doctors and departments (the chosen period) ----
    in_period = Q(appointments__start__gte=start, appointments__start__lt=end)
    not_cancelled = in_period & ~Q(appointments__status=CANCELLED)
    seen = in_period & ~Q(appointments__status__in=NOT_VISITS)
    doctors = (
        DoctorProfile.objects.filter(hospital=hospital)
        .select_related("user", "department")
        .annotate(
            n_appointments=Count("appointments", filter=not_cancelled, distinct=True),
            n_completed=Count("appointments", filter=in_period & Q(appointments__status=COMPLETED), distinct=True),
            n_cancelled=Count("appointments", filter=in_period & Q(appointments__status=CANCELLED), distinct=True),
            n_no_show=Count("appointments", filter=in_period & Q(appointments__status=NO_SHOW), distinct=True),
            n_patients=Count("appointments__patient", filter=seen, distinct=True),
        )
    )
    doctor_rows, departments = [], {}
    for d in doctors:
        name = d.user.get_full_name() or d.user.email
        dept = d.department.name if d.department else ""
        row = {"id": d.id, "name": name, "specialization": d.specialization, "department": dept,
               "appointments": d.n_appointments, "completed": d.n_completed, "cancelled": d.n_cancelled, "no_show": d.n_no_show,
               "patients": d.n_patients}
        doctor_rows.append(row)
        agg = departments.setdefault(dept, {"name": dept, "doctors": 0, "appointments": 0, "completed": 0, "cancelled": 0, "no_show": 0})
        agg["doctors"] += 1
        for k in ("appointments", "completed", "cancelled", "no_show"):
            agg[k] += row[k]
    # Patients per department are counted directly (a patient who saw two doctors there counts once).
    for dept, agg in departments.items():
        agg["patients"] = (
            period.exclude(status__in=NOT_VISITS).filter(doctor__department__name=dept) if dept
            else period.exclude(status__in=NOT_VISITS).filter(doctor__department__isnull=True)
        ).values("patient").distinct().count()

    doctor_rows.sort(key=lambda r: (-r["appointments"], r["name"].lower()))
    dept_rows = sorted(departments.values(), key=lambda r: (-r["appointments"], r["name"] == "", r["name"].lower()))

    return {
        "months": [m.strftime("%b %Y") for m in months],  # same labels as the platform reports
        "appointments": {"booked": booked, "completed": completed, "no_show": no_show},
        "totals": totals,
        "patients": patients,
        "doctors": doctor_rows,
        "departments": dept_rows,
    }
