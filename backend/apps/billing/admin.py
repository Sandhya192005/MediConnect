from django.contrib import admin

from .models import PaymentItem, PaymentSlip


class PaymentItemInline(admin.TabularInline):
    model = PaymentItem
    extra = 0
    readonly_fields = ["description", "quantity", "unit_price", "amount"]
    can_delete = False


@admin.register(PaymentSlip)
class PaymentSlipAdmin(admin.ModelAdmin):
    """Read-only view for the platform admin; hospitals manage slips in the app (amounts are worked out there)."""

    list_display = ["number", "hospital", "patient", "total", "status", "issued_on"]
    list_filter = ["status", "hospital"]
    search_fields = ["number", "patient__email", "patient__first_name"]
    inlines = [PaymentItemInline]

    def has_change_permission(self, request, obj=None):
        return False

    def has_add_permission(self, request):
        return False
