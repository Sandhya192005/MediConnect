"""
Payment slip API (owner request 2026-11-21).

Hospital (its own slips only):
  GET  /api/hospital-admin/payments/?patient=<patient_id>&status=   list + totals
  POST /api/hospital-admin/payments/   {patient_id, items:[{description, quantity, unit_price}], discount?,
                                        notes?, issued_on?, appointment?, status?, method?, paid_on?}
  GET/PATCH /api/hospital-admin/payments/<id>/            (PATCH: pending slips only)
  POST …/<id>/complete/ {method, paid_on?} · …/<id>/reopen/ {reason} · …/<id>/cancel/ {reason?}
Patient (read-only, their own):
  GET /api/payments/ · GET /api/payments/<id>/
"""

from decimal import Decimal

from django.db.models import Sum
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response

from apps.accounts.models import PatientProfile
from apps.accounts.permissions import IsHospitalAdmin, IsPatient

from . import services
from .models import PaymentSlip


def slip_data(s: PaymentSlip) -> dict:
    """Everything the slip page shows, including the hospital and patient it's from and for."""
    h, p = s.hospital, s.patient
    profile = getattr(p, "patient_profile", None)
    return {
        "id": s.id, "number": s.number, "issued_on": s.issued_on,
        "status": s.status, "status_label": s.get_status_display(),
        "items": [{"description": i.description, "quantity": i.quantity, "unit_price": i.unit_price, "amount": i.amount}
                  for i in s.items.all()],
        "subtotal": s.subtotal, "discount": s.discount, "total": s.total,
        "notes": s.notes, "method": s.method, "method_label": s.get_method_display() if s.method else "",
        "paid_on": s.paid_on, "reopen_reason": s.reopen_reason, "cancel_reason": s.cancel_reason,
        "appointment": s.appointment_id,
        "visit": {"start": s.appointment.start, "doctor_name": str(s.appointment.doctor)} if s.appointment_id else None,
        "hospital": {"name": h.name, "address": h.address, "city": h.city, "state": h.state, "phone": h.phone,
                     "email": h.email},
        "patient": {"name": p.get_full_name() or "Patient", "patient_id": profile.patient_id if profile else None,
                    "phone": p.phone},
        "created_at": s.created_at,
    }


def _totals(qs) -> dict:
    def total(status):
        return qs.filter(status=status).aggregate(t=Sum("total"))["t"] or Decimal("0")
    return {"pending": total(PaymentSlip.Status.PENDING), "completed": total(PaymentSlip.Status.COMPLETED)}


SLIP_QS = PaymentSlip.objects.select_related("hospital", "patient__patient_profile", "appointment__doctor__user") \
    .prefetch_related("items")


class HospitalPaymentViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsHospitalAdmin]

    def get_queryset(self):
        qs = SLIP_QS.filter(hospital=self.request.admin_hospital)
        p = self.request.query_params
        if pid := p.get("patient", "").strip().upper():
            qs = qs.filter(patient__patient_profile__patient_id=pid)
        if (st := p.get("status")) in PaymentSlip.Status.values:
            qs = qs.filter(status=st)
        return qs

    def list(self, request):
        qs = self.get_queryset()
        return Response({"totals": _totals(qs), "slips": [slip_data(s) for s in qs[:200]]})

    def retrieve(self, request, pk=None):
        return Response(slip_data(self.get_object()))

    def create(self, request):
        from apps.staff.patients import in_hospital_list

        profile = (PatientProfile.objects.select_related("user")
                   .filter(patient_id=str(request.data.get("patient_id", "")).strip().upper(), user__is_active=True).first())
        if profile is None:
            raise NotFound("No patient with this ID.")
        if not in_hospital_list(request.admin_hospital, profile.user):
            raise PermissionDenied("Add this patient to your patients first.")
        slip = services.create(request.admin_hospital, profile.user, request.user, request.data)
        return Response(slip_data(SLIP_QS.get(pk=slip.pk)), status=201)

    def partial_update(self, request, pk=None):
        slip = services.update(self.get_object(), request.data)
        return Response(slip_data(SLIP_QS.get(pk=slip.pk)))

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        return Response(slip_data(services.complete(self.get_object(), request.data)))

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        return Response(slip_data(services.reopen(self.get_object(), request.data)))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return Response(slip_data(services.cancel(self.get_object(), request.data)))


class MyPaymentViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """A patient's own slips, from every hospital. Read-only."""

    permission_classes = [IsPatient]

    def get_queryset(self):
        return SLIP_QS.filter(patient=self.request.user)

    def list(self, request):
        qs = self.get_queryset()
        return Response({"totals": _totals(qs), "slips": [slip_data(s) for s in qs[:200]]})

    def retrieve(self, request, pk=None):
        return Response(slip_data(self.get_object()))
