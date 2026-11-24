"""The rules for payment slips (see models.py). Views stay thin; everything that changes a slip is here."""

import re
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.hospitals.models import Hospital

from .models import PaymentItem, PaymentSlip

MAX_ITEMS = 50
MAX_AMOUNT = Decimal("10000000")  # ₹1 crore per line: catches typing mistakes like an extra zero row
PAISA = Decimal("0.01")


def money(value, field: str) -> Decimal:
    try:
        d = Decimal(str(value).replace(",", "").strip() or "0").quantize(PAISA)
    except (InvalidOperation, ValueError):
        raise ValidationError({field: "Enter an amount in rupees, e.g. 700 or 450.50."})
    if d < 0:
        raise ValidationError({field: "The amount can't be negative."})
    if d > MAX_AMOUNT:
        raise ValidationError({field: "That amount is too large; check it."})
    return d


def prefix_for(hospital: Hospital) -> str:
    """Initials of the hospital's name, e.g. "E2E Partner Hospital" → "EPH" (up to 4 letters)."""
    words = re.findall(r"[A-Za-z0-9]+", hospital.name)
    return ("".join(w[0] for w in words)[:4] or "MC").upper()


def next_number(hospital: Hospital, on) -> str:
    """The next slip number for this hospital and year. Call inside a transaction that locked the hospital row."""
    start = f"{prefix_for(hospital)}-{on.year}-"
    last = (PaymentSlip.objects.filter(hospital=hospital, number__startswith=start)
            .order_by("-number").values_list("number", flat=True).first())
    n = int(last.rsplit("-", 1)[1]) + 1 if last else 1
    return f"{start}{n:04d}"


def _clean_items(items) -> list[dict]:
    if not isinstance(items, list) or not items:
        raise ValidationError({"items": "Add at least one line, e.g. “Consultation ₹700”."})
    if len(items) > MAX_ITEMS:
        raise ValidationError({"items": f"A slip can have up to {MAX_ITEMS} lines."})
    clean = []
    for i, it in enumerate(items):
        desc = " ".join(str((it or {}).get("description", "")).split())[:150]
        if not desc:
            raise ValidationError({"items": f"Line {i + 1}: write what it's for."})
        try:
            qty = int((it or {}).get("quantity") or 1)
        except (TypeError, ValueError):
            raise ValidationError({"items": f"Line {i + 1}: the quantity must be a whole number."})
        if not 1 <= qty <= 999:
            raise ValidationError({"items": f"Line {i + 1}: the quantity must be 1 to 999."})
        price = money((it or {}).get("unit_price", 0), "items")
        clean.append({"description": desc, "quantity": qty, "unit_price": price, "amount": (price * qty).quantize(PAISA)})
    return clean


def _apply(slip: PaymentSlip, data, *, creating: bool) -> None:
    """Sets lines, discount, notes, date and visit from `data`, and works the totals out."""
    items = _clean_items(data.get("items")) if creating or "items" in data else None
    if items is not None:
        slip.subtotal = sum((i["amount"] for i in items), Decimal("0"))
    if creating or "discount" in data:
        slip.discount = money(data.get("discount", 0), "discount")
    if slip.discount > slip.subtotal:
        raise ValidationError({"discount": "The discount can't be more than the bill."})
    slip.total = slip.subtotal - slip.discount
    if "notes" in data:
        slip.notes = " ".join(str(data.get("notes") or "").split())[:500]
    if "issued_on" in data and data["issued_on"]:
        try:
            issued = timezone.datetime.fromisoformat(str(data["issued_on"])).date()
        except ValueError:
            raise ValidationError({"issued_on": "Use a date like 2026-11-21."})
        if issued > timezone.localdate():
            raise ValidationError({"issued_on": "The slip date can't be in the future."})
        slip.issued_on = issued
    if "appointment" in data:
        slip.appointment = _visit(slip, data.get("appointment"))
    slip.save()
    if items is not None:
        slip.items.all().delete()
        PaymentItem.objects.bulk_create([PaymentItem(slip=slip, position=n, **i) for n, i in enumerate(items)])


def _visit(slip: PaymentSlip, appointment_id):
    from apps.appointments.models import Appointment

    if not appointment_id:
        return None
    visit = Appointment.objects.filter(pk=appointment_id, patient=slip.patient, doctor__hospital=slip.hospital).first()
    if visit is None:
        raise ValidationError({"appointment": "Choose one of this patient's visits at your hospital."})
    return visit


def _paid(slip: PaymentSlip, data) -> None:
    method = str(data.get("method") or "")
    if method not in PaymentSlip.Method.values:
        raise ValidationError({"method": "Choose how it was paid: cash, card, UPI, insurance or other."})
    paid_on = timezone.localdate()
    if data.get("paid_on"):
        try:
            paid_on = timezone.datetime.fromisoformat(str(data["paid_on"])).date()
        except ValueError:
            raise ValidationError({"paid_on": "Use a date like 2026-11-21."})
        if paid_on > timezone.localdate():
            raise ValidationError({"paid_on": "The paid date can't be in the future."})
    slip.status, slip.method, slip.paid_on = PaymentSlip.Status.COMPLETED, method, paid_on


def create(hospital: Hospital, patient, user, data) -> PaymentSlip:
    """A new slip (pending, or completed straight away if `status` is "completed" with a method)."""
    with transaction.atomic():
        Hospital.objects.select_for_update().get(pk=hospital.pk)  # one number at a time per hospital
        slip = PaymentSlip(hospital=hospital, patient=patient, created_by=user, issued_on=timezone.localdate())
        _apply(slip, {**data, "issued_on": data.get("issued_on")}, creating=True)
        slip.number = next_number(hospital, slip.issued_on)
        if data.get("status") == PaymentSlip.Status.COMPLETED:
            _paid(slip, data)
        slip.save()
    _tell_patient(slip, "created")
    return slip


def update(slip: PaymentSlip, data) -> PaymentSlip:
    if slip.status != PaymentSlip.Status.PENDING:
        raise ValidationError({"status": "Only a pending slip can be changed. Set a completed slip back to pending first."})
    with transaction.atomic():
        _apply(slip, data, creating=False)
    return slip


def complete(slip: PaymentSlip, data) -> PaymentSlip:
    if slip.status != PaymentSlip.Status.PENDING:
        raise ValidationError({"status": "Only a pending slip can be marked as paid."})
    _paid(slip, data)
    slip.save(update_fields=["status", "method", "paid_on", "updated_at"])
    _tell_patient(slip, "paid")
    return slip


def reopen(slip: PaymentSlip, data) -> PaymentSlip:
    reason = " ".join(str(data.get("reason") or "").split())[:300]
    if slip.status != PaymentSlip.Status.COMPLETED:
        raise ValidationError({"status": "Only a completed slip can be set back to pending."})
    if not reason:
        raise ValidationError({"reason": "Say why it's no longer paid; the reason is shown on the slip."})
    slip.status, slip.method, slip.paid_on, slip.reopen_reason = PaymentSlip.Status.PENDING, "", None, reason
    slip.save(update_fields=["status", "method", "paid_on", "reopen_reason", "updated_at"])
    return slip


def cancel(slip: PaymentSlip, data) -> PaymentSlip:
    if slip.status != PaymentSlip.Status.PENDING:
        raise ValidationError({"status": "Only a pending slip can be cancelled."})
    slip.status = PaymentSlip.Status.CANCELLED
    slip.cancel_reason = " ".join(str(data.get("reason") or "").split())[:300]
    slip.save(update_fields=["status", "cancel_reason", "updated_at"])
    return slip


def _tell_patient(slip: PaymentSlip, what: str) -> None:
    from apps.notifications.realtime import create_notification

    amount = f"₹{slip.total:,.2f}".replace(".00", "")
    if what == "created":
        title, msg = "New payment slip", f"{slip.hospital.name}: {slip.number}, {amount} ({slip.get_status_display().lower()})."
    else:
        title, msg = "Payment received", f"{slip.hospital.name} marked {slip.number} ({amount}) as paid."
    transaction.on_commit(lambda: create_notification(slip.patient, f"payment_{what}", title, msg, "/patient/payments"))
