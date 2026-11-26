"""
Hospital admin API (Step 4), under /api/hospital-admin/. Everything is limited to the admin's own hospital
(request.admin_hospital, set by IsHospitalAdmin); another hospital's data is never visible.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Count, Max, Min, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsHospitalAdmin
from apps.analytics.services import aware, pct_change
from apps.appointments.models import ACTIVE_STATUSES, Appointment
from apps.appointments.queue import day_bounds
from apps.doctors.models import DoctorProfile
from apps.records.models import MedicalRecord
from apps.records.services import RELATED_STATUSES

from .models import HospitalPatient, StaffMember
from .serializers import StaffMemberSerializer

User = get_user_model()
CHART_MONTHS = 6
# Everyone who isn't a doctor or a nurse: the "Other staff" page.
OTHER_STAFF_KINDS = [k for k in StaffMember.Kind.values if k not in (StaffMember.Kind.DOCTOR, StaffMember.Kind.NURSE)]


class StaffViewSet(viewsets.ModelViewSet):
    """
    /api/hospital-admin/staff/ — the hospital's doctors and nurses.
    Doctors, nurses and other staff. Filters: ?kind=doctor (or several: ?kind=pharmacist,receptionist, or
    ?kind=other_staff for every kind except doctors and nurses), ?q=name/designation/email, ?status=active|left
    """

    serializer_class = StaffMemberSerializer
    permission_classes = [IsHospitalAdmin]
    http_method_names = ["get", "post", "patch", "delete"]

    def get_queryset(self):
        qs = (StaffMember.objects.filter(hospital=self.request.admin_hospital)
              .select_related("department", "doctor__user", "doctor__hospital"))
        p = self.request.query_params
        if kind := p.get("kind"):
            kinds = OTHER_STAFF_KINDS if kind == "other_staff" else kind.split(",")
            qs = qs.filter(kind__in=kinds)
        if q := p.get("q", "").strip():
            qs = qs.filter(Q(full_name__icontains=q) | Q(designation__icontains=q) | Q(email__icontains=q)
                           | Q(phone__icontains=q) | Q(specialization__icontains=q) | Q(department__name__icontains=q))
        if p.get("status") == "active":
            qs = qs.active()
        elif p.get("status") == "left":
            qs = qs.filter(left_on__lte=timezone.localdate())
        return qs

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "hospital": getattr(self.request, "admin_hospital", None)}

    def perform_create(self, serializer):
        serializer.save(hospital=self.request.admin_hospital)


class DoctorAccountsView(APIView):
    """GET /api/hospital-admin/doctor-accounts/ — MediConnect doctor accounts at this hospital without a staff record."""

    permission_classes = [IsHospitalAdmin]

    def get(self, request):
        doctors = (
            DoctorProfile.objects.filter(hospital=request.admin_hospital, staff_record__isnull=True)
            .select_related("user", "department")
            .order_by("user__first_name")
        )
        return Response([
            {"id": d.id, "name": d.user.get_full_name() or d.user.email, "email": d.user.email,
             "specialization": d.specialization, "department": d.department_id}
            for d in doctors
        ])


def hospital_patients(hospital):
    """
    The hospital's patients: everyone with a booked, confirmed or completed visit there, plus the patients
    it added in Patient management (owner request 2026-11-21).
    """
    from .patients import hospital_patient_q

    return User.objects.filter(hospital_patient_q(hospital), role="patient").distinct()


class PatientsView(APIView):
    """GET /api/hospital-admin/patients/?q= — the hospital's patients with their visits (max 200)."""

    permission_classes = [IsHospitalAdmin]

    def get(self, request):
        """
        Simple columns (owner requests 2026-11-22): Visit (the date the hospital set, else today's / the next /
        the last appointment here) and Visit status (past, current, upcoming), Records (how many records THIS hospital uploaded for the patient) and Payment
        (pending amount, or completed when every slip is paid).
        """
        from apps.billing.models import PaymentSlip

        hospital = request.admin_hospital
        here = Q(appointments__doctor__hospital=hospital)
        ours = (MedicalRecord.objects.filter(patient=OuterRef("pk"), uploaded_by_hospital=hospital, hidden_for_hospital=False)
                .values("patient").annotate(n=Count("id")).values("n"))
        slips = PaymentSlip.objects.filter(patient=OuterRef("pk"), hospital=hospital)
        owed = (slips.filter(status=PaymentSlip.Status.PENDING).values("patient").annotate(t=Sum("total")).values("t"))
        paid = (slips.filter(status=PaymentSlip.Status.COMPLETED).values("patient").annotate(n=Count("id")).values("n"))
        from apps.appointments.queue import day_bounds

        from .patients import pick_visit

        start_of_today, _ = day_bounds()
        qs = hospital_patients(hospital).select_related("patient_profile").annotate(
            last_done=Max("appointments__start", filter=here & Q(appointments__status="completed")),
            next_start=Min("appointments__start", filter=here & Q(appointments__status__in=ACTIVE_STATUSES,
                                                                    appointments__start__gte=start_of_today)),
            records=Coalesce(Subquery(ours), 0),
            pending_amount=Coalesce(Subquery(owed), Decimal("0")),
            paid_slips=Coalesce(Subquery(paid), 0),
        )
        if q := request.query_params.get("q", "").strip():
            qs = qs.filter(Q(first_name__icontains=q) | Q(last_name__icontains=q) | Q(email__icontains=q)
                           | Q(phone__icontains=q) | Q(patient_profile__patient_id__iexact=q))
        rows = list(qs.order_by("first_name", "last_name")[:200])
        links = {l.patient_id: l for l in HospitalPatient.objects.filter(hospital=hospital, patient__in=rows)}
        out = []
        for p in rows:
            link = links.get(p.id)
            payment = "pending" if p.pending_amount > 0 else "completed" if p.paid_slips else None
            out.append({
                "patient_id": getattr(getattr(p, "patient_profile", None), "patient_id", None),
                "name": p.get_full_name() or p.email,
                "email": p.email if p.has_real_email else None,
                "phone": p.phone,
                "added_by_you": link is not None,
                "created_by_you": bool(link and link.created_account),
                **pick_visit(link.visited_on if link else None, p.next_start, p.last_done),
                "records": p.records,
                "payment": payment,
                "pending_amount": p.pending_amount,
            })
        return Response(out)


class ReportsView(APIView):
    """GET /api/hospital-admin/reports/?months=12 (3–24) — appointments, patients, doctors and departments."""

    permission_classes = [IsHospitalAdmin]

    def get(self, request):
        from .reports import hospital_reports

        try:
            months = min(24, max(3, int(request.query_params.get("months", 12))))
        except ValueError:
            months = 12
        return Response(hospital_reports(request.admin_hospital, months))


class DoctorAppointmentsView(APIView):
    """
    GET /api/hospital-admin/doctors/<doctor_profile_id>/appointments/ — one doctor's appointments at this
    hospital for Doctor management (booking flow, owner decision 2026-11-21): waiting for their answer,
    accepted (confirmed or done) and rejected (every DoctorRejection, also after the hospital reassigned it).
    """

    permission_classes = [IsHospitalAdmin]

    def get(self, request, pk):
        from apps.appointments.models import DoctorRejection
        from apps.appointments.serializers import AppointmentSerializer

        hospital = request.admin_hospital
        doctor = DoctorProfile.objects.select_related("user", "department").filter(pk=pk, hospital=hospital).first()
        if doctor is None:
            return Response({"detail": "Not one of your hospital's doctors."}, status=404)
        here = (Appointment.objects.filter(doctor=doctor, doctor__hospital=hospital)
                .select_related("patient__patient_profile", "doctor__user", "doctor__hospital")
                .prefetch_related("rejections__doctor__user"))
        ctx = {"request": request}
        waiting = here.filter(status=Appointment.Status.BOOKED, awaiting_doctor=True).order_by("start")
        accepted = here.filter(status__in=["confirmed", "completed", "no_show"]).order_by("-start")[:100]
        rejected = (DoctorRejection.objects.filter(doctor=doctor, appointment__doctor__hospital=hospital)
                    .select_related("appointment__patient__patient_profile")[:100])
        # The appointment may have moved on to another doctor: rejections are listed by what this doctor saw.
        rejected_rows = [{
            "id": r.id, "reason": r.reason, "at": r.created_at, "appointment": r.appointment_id,
            "start": r.appointment.start, "patient_name": r.appointment.patient.get_full_name() or r.appointment.patient.email,
            "patient_id": getattr(getattr(r.appointment.patient, "patient_profile", None), "patient_id", None),
            "now_with": str(r.appointment.doctor) if r.appointment.doctor_id != doctor.id else "",
            "status": r.appointment.status,
        } for r in rejected]
        return Response({
            "doctor": {"id": doctor.id, "name": str(doctor), "specialization": doctor.specialization,
                       "department": doctor.department.name if doctor.department else "", "email": doctor.user.email,
                       "is_bookable": doctor.is_bookable},
            "counts": {"waiting": waiting.count(), "accepted": here.filter(status__in=["confirmed", "completed", "no_show"]).count(),
                       "rejected": DoctorRejection.objects.filter(doctor=doctor, appointment__doctor__hospital=hospital).count()},
            "waiting": AppointmentSerializer(waiting, many=True, context=ctx).data,
            "accepted": AppointmentSerializer(accepted, many=True, context=ctx).data,
            "rejected": rejected_rows,
        })


class PayrollView(APIView):
    """
    GET /api/hospital-admin/payroll/?months=12 — the hospital's salary cost per month (owner request 2026-11-18).

    A person counts in a month if they worked there on at least one day of it (joined by the month's end,
    not left before it started), with their full monthly salary. MediConnect stores only each person's
    CURRENT salary, so past months use today's salaries: the page says so.
    """

    permission_classes = [IsHospitalAdmin]

    def get(self, request):
        try:
            months = min(max(int(request.query_params.get("months", 12)), 1), 24)
        except ValueError:
            months = 12
        today = timezone.localdate()
        staff = list(StaffMember.objects.filter(hospital=request.admin_hospital).only("kind", "join_date", "left_on", "monthly_salary"))

        rows = []
        for end in _month_ends(today, months):  # this month ends today: future joiners don't count yet
            start = end.replace(day=1)
            working = [s for s in staff
                       if s.join_date <= end and (s.left_on is None or (s.left_on > start and s.left_on > s.join_date))]
            def pay(kinds):
                return sum((s.monthly_salary for s in working if s.kind in kinds), Decimal(0))
            rows.append({
                "month": start.strftime("%b %Y"),
                "people": len(working),
                "doctors": pay([StaffMember.Kind.DOCTOR]),
                "nurses": pay([StaffMember.Kind.NURSE]),
                "other_staff": pay(OTHER_STAFF_KINDS),
                "total": pay(StaffMember.Kind.values),
            })
        return Response({"months": rows, "based_on_current_salaries": True})


def _role_words(s: StaffMember) -> str:
    """How to name a staff member's role in a sentence: "nurse", "housekeeping staff", "ambulance driver"."""
    if s.kind == StaffMember.Kind.OTHER:
        return s.designation.strip().lower() or "staff member"
    if s.kind in (StaffMember.Kind.HOUSEKEEPING, StaffMember.Kind.SECURITY, StaffMember.Kind.OFFICE):
        return f"{s.get_kind_display().split(' /')[0].lower()} staff"
    return s.get_kind_display().lower()


def _month_ends(today: date, months: int) -> list[date]:
    """The last day of each of the last `months` months, oldest first (this month: today)."""
    ends, y, m = [], today.year, today.month
    for _ in range(months):
        first_of_next = date(y + (m == 12), m % 12 + 1, 1)
        ends.append(min(first_of_next - timedelta(days=1), today))
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return list(reversed(ends))


class OverviewView(APIView):
    """GET /api/hospital-admin/overview/ — the hospital admin dashboard: counts, staff chart, recent activity."""

    permission_classes = [IsHospitalAdmin]

    def get(self, request):
        hospital, today = request.admin_hospital, timezone.localdate()
        staff = StaffMember.objects.filter(hospital=hospital)
        active = staff.active()
        start, end = day_bounds()
        todays = Appointment.objects.filter(doctor__hospital=hospital, start__gte=start, start__lt=end)

        chart = [
            {
                "month": d.strftime("%b"),
                "doctors": staff.active(on=d).filter(kind="doctor").count(),
                "nurses": staff.active(on=d).filter(kind="nurse").count(),
            }
            for d in _month_ends(today, CHART_MONTHS)
        ]

        return Response({
            # connected = approved by the platform admin: patients can find and book it.
            "hospital": {"id": hospital.id, "name": hospital.name, "city": hospital.city, "connected": hospital.is_approved},
            "counts": {
                "doctors": active.filter(kind="doctor").count(),
                "nurses": active.filter(kind="nurse").count(),
                "other_staff": active.filter(kind__in=OTHER_STAFF_KINDS).count(),
                "patients": hospital_patients(hospital).count(),
                "appointments_today": todays.exclude(status="cancelled").count(),
                "to_confirm": Appointment.objects.filter(doctor__hospital=hospital, awaiting_hospital=True,
                                                         status=Appointment.Status.BOOKED).count(),
                "waiting_for_doctors": Appointment.objects.filter(doctor__hospital=hospital, awaiting_doctor=True,
                                                                  status=Appointment.Status.BOOKED).count(),
                "waiting_now": todays.filter(status__in=ACTIVE_STATUSES, checked_in_at__isnull=False,
                                             consultation_started_at__isnull=True).count(),
                "doctor_accounts_without_record": DoctorProfile.objects.filter(
                    hospital=hospital, staff_record__isnull=True).count(),
            },
            "payroll": {
                "monthly_total": active.aggregate(t=Sum("monthly_salary"))["t"] or 0,
                "doctors": active.filter(kind="doctor").aggregate(t=Sum("monthly_salary"))["t"] or 0,
                "nurses": active.filter(kind="nurse").aggregate(t=Sum("monthly_salary"))["t"] or 0,
                "other_staff": active.filter(kind__in=OTHER_STAFF_KINDS).aggregate(t=Sum("monthly_salary"))["t"] or 0,
            },
            "staff_chart": chart,
            "trends": self._trends(hospital, staff, today),
            "recent_activity": self._recent(hospital, staff),
        })

    def _trends(self, hospital, staff, today):
        """
        % change for the dashboard cards (owner request 2026-11-21), counted from real data only. Each card
        has "now", "before" and "change_pct" (None when "before" is 0: nothing to compare with).
        - staff (doctors / nurses / other staff): on staff today vs on the last day of last month;
        - patients: the hospital's patients now vs at the start of this month (by when the booking was made);
        - today's appointments: vs the same weekday last week (weekdays differ: Sundays are quieter).
        """
        month_start = today.replace(day=1)
        last_month_end = month_start - timedelta(days=1)

        def trend(now, before):
            return {"now": now, "before": before, "change_pct": pct_change(now, before)}

        def on_staff(kinds, on=None):
            return staff.active(on=on).filter(kind__in=kinds).count()

        patients_before = User.objects.filter(
            Q(appointments__doctor__hospital=hospital, appointments__status__in=RELATED_STATUSES,
              appointments__created_at__lt=aware(month_start))
            | Q(hospital_links__hospital=hospital, hospital_links__created_at__lt=aware(month_start)),
            role="patient",
        ).distinct().count()
        week_ago_start, week_ago_end = day_bounds(today - timedelta(days=7))
        start, end = day_bounds(today)
        visits = Appointment.objects.filter(doctor__hospital=hospital).exclude(status="cancelled")
        return {
            "doctors": trend(on_staff(["doctor"]), on_staff(["doctor"], last_month_end)),
            "nurses": trend(on_staff(["nurse"]), on_staff(["nurse"], last_month_end)),
            "other_staff": trend(on_staff(OTHER_STAFF_KINDS), on_staff(OTHER_STAFF_KINDS, last_month_end)),
            "patients": trend(hospital_patients(hospital).count(), patients_before),
            "appointments_today": trend(visits.filter(start__gte=start, start__lt=end).count(),
                                        visits.filter(start__gte=week_ago_start, start__lt=week_ago_end).count()),
        }

    def _recent(self, hospital, staff, limit=6):
        """Newest staff records and bookings at the hospital, merged by time."""
        items = [
            {"kind": "staff", "title": f"New {_role_words(s)} added", "detail": s.full_name, "at": s.created_at}
            for s in staff.order_by("-created_at")[:limit]
        ]
        bookings = (Appointment.objects.filter(doctor__hospital=hospital).select_related("patient", "doctor__user")
                    .order_by("-created_at")[:limit])
        items += [
            {"kind": "booking", "title": "New appointment booked",
             "detail": f"{a.patient.get_full_name() or a.patient.email} with {a.doctor}", "at": a.created_at}
            for a in bookings
        ]
        return sorted(items, key=lambda i: i["at"], reverse=True)[:limit]
