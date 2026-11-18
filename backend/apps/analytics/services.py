"""
Numbers for the platform admin's dashboard and reports. Everything is counted from the real tables;
nothing is stored separately, so the reports are always up to date.

Definitions (also shown on the pages):
- patients / doctors: active accounts with that role;
- connected hospital: approved on MediConnect (Hospital.is_approved); "bookable" = it also has a doctor with
  working hours. Approval dates before 2026-11-17 are estimated (the date the hospital was added);
- active patient / doctor in a month: had at least one appointment (not cancelled) that month.
"""

from datetime import date, datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, Exists, Min, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone

from apps.appointments.models import Appointment
from apps.hospitals.models import Hospital
from apps.records.models import MedicalRecord
from apps.staff.models import HospitalAdmin, StaffMember

User = get_user_model()


def month_starts(months: int, today: date | None = None) -> list[date]:
    """First day of each of the last `months` months, oldest first (the current month last)."""
    today = today or timezone.localdate()
    y, m, out = today.year, today.month, []
    for _ in range(months):
        out.append(date(y, m, 1))
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return list(reversed(out))


def aware(d: date) -> datetime:
    return timezone.make_aware(datetime.combine(d, time.min))


def per_month(qs, field: str, months: list[date], count="id", distinct=False) -> list[int]:
    """How many rows of qs fall in each month (by `field`), as a list aligned with `months`."""
    start = aware(months[0])
    rows = (
        qs.filter(**{f"{field}__gte": start})
        .annotate(m=TruncMonth(field))
        .values("m")
        .annotate(c=Count(count, distinct=distinct))
    )
    by_month = {timezone.localtime(r["m"]).date().replace(day=1) if isinstance(r["m"], datetime) else r["m"]: r["c"]
                for r in rows}
    return [by_month.get(m, 0) for m in months]


def pct_change(now: int, before: int) -> float | None:
    """Growth in percent; None when there's nothing to compare with."""
    if before == 0:
        return None
    return round((now - before) * 100 / before, 1)


def patients():
    return User.objects.filter(role="patient", is_active=True)


def doctors():
    return User.objects.filter(role="doctor", is_active=True)


def connected_hospitals():
    return Hospital.objects.filter(is_approved=True)


def active_appointments():
    return Appointment.objects.exclude(status=Appointment.Status.CANCELLED)


def hospital_account_dates() -> list[datetime]:
    """
    Hospitals that run their management on MediConnect: they have at least one hospital admin login
    (admin_profile). The date is when their first admin login was linked.
    """
    return list(
        HospitalAdmin.objects.values("hospital").annotate(since=Min("created_at")).values_list("since", flat=True)
    )


def bucket_by_month(dates: list[datetime], months: list[date]) -> list[int]:
    """Count datetimes per month (aligned with `months`), in the app's time zone."""
    counts = {m: 0 for m in months}
    for d in dates:
        key = timezone.localtime(d).date().replace(day=1)
        if key in counts:
            counts[key] += 1
    return [counts[m] for m in months]


def overview() -> dict:
    now = timezone.now()
    month_start = aware(timezone.localdate().replace(day=1))
    last_month_start = aware(month_starts(2)[0])
    same_point_last_month = last_month_start + (now - month_start)  # compare equal stretches of time

    def total_with_growth(qs, joined_field):
        total = qs.count()
        at_month_start = qs.filter(**{f"{joined_field}__lt": month_start}).count()
        return {"total": total, "new_this_month": total - at_month_start, "change_pct": pct_change(total, at_month_start)}

    booked = Appointment.objects
    this_month = booked.filter(created_at__gte=month_start).count()
    last_month_so_far = booked.filter(created_at__gte=last_month_start, created_at__lt=same_point_last_month).count()

    account_dates = hospital_account_dates()
    accounts_now, accounts_before = len(account_dates), sum(1 for d in account_dates if d < month_start)

    months = month_starts(6)
    return {
        "hospital_accounts": {
            "total": accounts_now,
            "new_this_month": accounts_now - accounts_before,
            "change_pct": pct_change(accounts_now, accounts_before),
            "with_staff_records": Hospital.objects.filter(admins__isnull=False, staff__isnull=False).distinct().count(),
        },
        "patients": total_with_growth(patients(), "date_joined"),
        "doctors": total_with_growth(doctors(), "date_joined"),
        "hospitals": {
            **total_with_growth(connected_hospitals(), "approved_at"),
            "bookable": connected_hospitals().filter(doctors__is_active=True, doctors__availability__isnull=False)
            .distinct().count(),
            "listed_not_connected": Hospital.objects.filter(is_approved=False).count(),
        },
        "appointments": {"this_month": this_month, "change_pct": pct_change(this_month, last_month_so_far)},
        "activity": {
            "months": [m.strftime("%b %Y") for m in months],
            "active_patients": per_month(active_appointments(), "start", months, count="patient", distinct=True),
            "active_doctors": per_month(active_appointments(), "start", months, count="doctor", distinct=True),
        },
        "recent": recent_events(),
    }


def recent_events(limit: int = 8) -> list[dict]:
    """Newest sign-ups and newly connected hospitals, merged by time."""
    items = [
        {"kind": u.role, "title": f"New {u.role} registered", "detail": u.get_full_name() or u.email, "at": u.date_joined}
        for u in User.objects.filter(role__in=["patient", "doctor"]).order_by("-date_joined")[:limit]
    ]
    items += [
        {"kind": "hospital", "title": "Hospital connected", "detail": f"{h.name}, {h.city}", "at": h.approved_at,
         "estimated": h.approved_at_estimated}
        for h in connected_hospitals().exclude(approved_at=None).order_by("-approved_at")[:limit]
    ]
    items += [
        {"kind": "hospital_account", "title": "Hospital account opened", "detail": f"{a.hospital.name}, {a.hospital.city}",
         "at": a.created_at}
        for a in HospitalAdmin.objects.select_related("hospital").order_by("-created_at")[:limit]
    ]
    return sorted(items, key=lambda i: i["at"], reverse=True)[:limit]


def reports(months_back: int = 12) -> dict:
    months = month_starts(months_back)
    last = months[-1]
    next_month = date(last.year + (last.month == 12), last.month % 12 + 1, 1)
    month_ends = [aware(m) for m in months[1:]] + [aware(next_month)]  # exclusive end of each month
    hospitals = connected_hospitals()
    account_dates = hospital_account_dates()

    return {
        "months": [m.strftime("%b %Y") for m in months],
        "usage": {
            "new_patients": per_month(patients(), "date_joined", months),
            "new_doctors": per_month(doctors(), "date_joined", months),
            "active_patients": per_month(active_appointments(), "start", months, count="patient", distinct=True),
            "active_doctors": per_month(active_appointments(), "start", months, count="doctor", distinct=True),
            "appointments_booked": per_month(Appointment.objects.all(), "created_at", months),
            "appointments_completed": per_month(Appointment.objects.filter(status="completed"), "start", months),
            "records_uploaded": per_month(MedicalRecord.objects.all(), "created_at", months),
            "check_ins": per_month(Appointment.objects.exclude(checked_in_at=None), "checked_in_at", months),
        },
        "growth": {
            "new_hospitals": per_month(hospitals, "approved_at", months),
            "total_hospitals": [hospitals.filter(approved_at__lt=end).count() for end in month_ends],
            "new_hospital_accounts": bucket_by_month(account_dates, months),
            "total_hospital_accounts": [sum(1 for d in account_dates if d < end) for end in month_ends],
            "total_patients": [patients().filter(date_joined__lt=end).count() for end in month_ends],
            "total_doctors": [doctors().filter(date_joined__lt=end).count() for end in month_ends],
        },
        "hospitals": hospital_table(),
    }


def hospital_table() -> list[dict]:
    """Every connected hospital with when it joined and how much it's used."""
    since = timezone.now() - timedelta(days=30)
    # Listed explicitly (not "~cancelled"): negating a filter across a join makes Django use a subquery.
    not_cancelled = Q(doctors__appointments__status__in=["booked", "confirmed", "completed"])
    rows = (
        connected_hospitals()
        .annotate(
            doctor_count=Count("doctors", filter=Q(doctors__is_active=True), distinct=True),
            patient_count=Count("doctors__appointments__patient", filter=not_cancelled, distinct=True),
            appointment_count=Count("doctors__appointments", filter=not_cancelled, distinct=True),
            appointments_30d=Count("doctors__appointments",
                                   filter=not_cancelled & Q(doctors__appointments__created_at__gte=since), distinct=True),
            # Subqueries (not joins) so these don't multiply with the appointment rows above.
            has_account=Exists(HospitalAdmin.objects.filter(hospital=OuterRef("pk"))),
            staff_count=Coalesce(Subquery(
                StaffMember.objects.active().filter(hospital=OuterRef("pk")).values("hospital")
                .annotate(c=Count("id")).values("c")), 0),
        )
        .order_by("-approved_at", "name")
    )
    return [
        {
            "id": h.id, "name": h.name, "city": h.city,
            "connected_on": timezone.localtime(h.approved_at).date() if h.approved_at else None,
            "estimated": h.approved_at_estimated,
            "doctors": h.doctor_count, "patients": h.patient_count,
            "appointments": h.appointment_count, "appointments_30d": h.appointments_30d,
            "has_account": h.has_account, "staff": h.staff_count,
        }
        for h in rows
    ]
