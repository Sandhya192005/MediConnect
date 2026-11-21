"""
Payment slips (owner decisions 2026-11-21): an itemised bill a hospital gives a patient in Patient management.

- Lines ("Consultation ₹700", "Blood test ₹450"…), an optional discount, and a total the server works out.
- Status: Pending → Completed (paid: method + paid date). A pending slip can be edited or cancelled; a
  completed slip is locked like a receipt and can only go back to Pending with a reason (shown on the slip).
- Numbered per hospital and year, e.g. "EPH-2026-0001".
- The patient sees their slips in the app (read-only) and can print them.
"""

from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q

MONEY = {"max_digits": 12, "decimal_places": 2}


class PaymentSlip(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        CARD = "card", "Card"
        UPI = "upi", "UPI"
        INSURANCE = "insurance", "Insurance"
        OTHER = "other", "Other"

    hospital = models.ForeignKey("hospitals.Hospital", on_delete=models.CASCADE, related_name="payment_slips")
    patient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="payment_slips")
    # Optional: the visit at this hospital it's for.
    appointment = models.ForeignKey("appointments.Appointment", on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name="payment_slips")
    number = models.CharField(max_length=30)
    issued_on = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    subtotal = models.DecimalField(**MONEY, default=Decimal("0"))
    discount = models.DecimalField(**MONEY, default=Decimal("0"))
    total = models.DecimalField(**MONEY, default=Decimal("0"))
    notes = models.CharField(max_length=500, blank=True)
    method = models.CharField(max_length=10, choices=Method.choices, blank=True)
    paid_on = models.DateField(null=True, blank=True)
    # Why a completed slip was set back to pending (kept on the slip), or why it was cancelled.
    reopen_reason = models.CharField(max_length=300, blank=True)
    cancel_reason = models.CharField(max_length=300, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "payment_slip"
        ordering = ["-issued_on", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["hospital", "number"], name="one_slip_number_per_hospital"),
            models.CheckConstraint(condition=Q(discount__gte=0) & Q(subtotal__gte=0) & Q(total__gte=0),
                                   name="slip_amounts_not_negative"),
            # Paid slips always say how and when they were paid.
            models.CheckConstraint(condition=~Q(status="completed") | (~Q(method="") & Q(paid_on__isnull=False)),
                                   name="completed_slip_has_method_and_date"),
        ]

    def __str__(self):
        return f"{self.number} · {self.patient} · ₹{self.total} ({self.status})"


class PaymentItem(models.Model):
    slip = models.ForeignKey(PaymentSlip, on_delete=models.CASCADE, related_name="items")
    description = models.CharField(max_length=150)
    quantity = models.PositiveSmallIntegerField(default=1)
    unit_price = models.DecimalField(**MONEY)
    amount = models.DecimalField(**MONEY)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "payment_item"
        ordering = ["position", "id"]
        constraints = [
            models.CheckConstraint(condition=Q(unit_price__gte=0) & Q(amount__gte=0) & Q(quantity__gte=1),
                                   name="payment_item_amounts_valid"),
        ]

    def __str__(self):
        return f"{self.description} ×{self.quantity} = ₹{self.amount}"
