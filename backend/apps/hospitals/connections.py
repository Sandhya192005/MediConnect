"""
Connecting a signed-up hospital with MediConnect (owner request 2026-11-18).

Hospital side (its admins):  GET/POST /api/hospital-admin/connection/
Platform side (superuser):   GET /api/platform/connection-requests/?status=pending
                             GET /api/platform/connected-hospitals/?q=  (connected hospitals, 2026-11-20)
                             POST /api/platform/connected-hospitals/<id>/disconnect/ {note}
                             POST /api/platform/connection-requests/<id>/approve/ {note}
                             POST /api/platform/connection-requests/<id>/decline/ {note}
"""

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsHospitalAdmin, IsPlatformAdmin

from .models import ConnectionRequest, Hospital

User = get_user_model()


def _notify(users, kind, title, message, link):
    """In-app notifications, sent once the database change is saved."""
    from apps.notifications.realtime import create_notification

    users = list(users)
    transaction.on_commit(lambda: [create_notification(u, kind, title, message[:300], link=link) for u in users])


class ConnectionRequestSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    hospital_name = serializers.CharField(source="hospital.name", read_only=True)
    hospital_city = serializers.CharField(source="hospital.city", read_only=True)
    hospital_address = serializers.CharField(source="hospital.address", read_only=True)
    hospital_phone = serializers.CharField(source="hospital.phone", read_only=True)
    hospital_source = serializers.CharField(source="hospital.source", read_only=True)
    requested_by_email = serializers.EmailField(source="requested_by.email", read_only=True, default=None)
    staff_count = serializers.SerializerMethodField()
    doctor_count = serializers.SerializerMethodField()

    class Meta:
        model = ConnectionRequest
        fields = ["id", "hospital", "hospital_name", "hospital_city", "hospital_address", "hospital_phone",
                  "hospital_source", "requested_by_email", "message", "status", "status_label", "admin_note",
                  "decided_at", "created_at", "staff_count", "doctor_count"]

    def get_staff_count(self, r):
        return r.hospital.staff.active().count()

    def get_doctor_count(self, r):
        return r.hospital.staff.active().filter(kind="doctor").count()


class HospitalConnectionView(APIView):
    """
    GET  — is my hospital connected, and my latest request (if any).
    POST {address, phone, message} — ask MediConnect to connect my hospital. The address and phone are
    saved on the hospital first, because patients will see them once it's connected.
    """

    permission_classes = [IsHospitalAdmin]

    def get(self, request):
        h = request.admin_hospital
        latest = h.connection_requests.first()
        return Response({
            "connected": h.is_approved,
            "hospital": {"name": h.name, "city": h.city, "address": h.address, "phone": h.phone},
            "request": ConnectionRequestSerializer(latest).data if latest else None,
        })

    def post(self, request):
        h = request.admin_hospital
        if h.is_approved:
            raise ValidationError({"detail": "Your hospital is already connected with MediConnect."})
        address = " ".join(str(request.data.get("address", "")).split())
        phone = str(request.data.get("phone", "")).strip()
        message = str(request.data.get("message", "")).strip()
        errors = {}
        if len(address) < 5:
            errors["address"] = "Enter the hospital's address, so patients can find it."
        if not phone:
            errors["phone"] = "Enter a phone number patients can call."
        if len(address) > 300 or len(phone) > 30 or len(message) > 500:
            errors["detail"] = "That's too long."
        if errors:
            raise ValidationError(errors)

        try:
            with transaction.atomic():
                h.address, h.phone = address, phone
                h.save(update_fields=["address", "phone"])
                req = ConnectionRequest.objects.create(hospital=h, requested_by=request.user, message=message)
        except IntegrityError:  # the database allows one pending request per hospital
            raise ValidationError({"detail": "Your request is already waiting for MediConnect."})

        _notify(User.objects.filter(is_superuser=True, is_active=True), "connection_requested",
                "Hospital wants to connect", f"{h.name}, {h.city} asked to connect with MediConnect.",
                "/admin/connections")
        return Response(ConnectionRequestSerializer(req).data, status=201)


class ConnectionRequestViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """The platform admin's list of connection requests, with approve / decline."""

    serializer_class = ConnectionRequestSerializer
    permission_classes = [IsPlatformAdmin]

    def get_queryset(self):
        qs = ConnectionRequest.objects.select_related("hospital", "requested_by")
        if status := self.request.query_params.get("status"):
            qs = qs.filter(status=status)
        return qs

    def _decide(self, request, pk, approve: bool):
        with transaction.atomic():
            req = get_object_or_404(ConnectionRequest.objects.select_for_update().select_related("hospital"), pk=pk)
            if req.status != ConnectionRequest.Status.PENDING:
                raise ValidationError({"detail": f"This request is already {req.get_status_display().lower()}."})
            note = str(request.data.get("note", "")).strip()[:500]
            if not approve and not note:
                raise ValidationError({"note": "Tell the hospital why, so they can fix it and ask again."})
            req.status = ConnectionRequest.Status.APPROVED if approve else ConnectionRequest.Status.DECLINED
            req.admin_note, req.decided_by, req.decided_at = note, request.user, timezone.now()
            req.save()
            if approve:
                req.hospital.is_approved = True
                req.hospital.save()  # also records approved_at (analytics: "connected hospitals")

        h = req.hospital
        title = "Your hospital is connected" if approve else "Connection request declined"
        msg = (f"{h.name} is now on MediConnect: patients can find it, and your doctors can take bookings."
               if approve else f"MediConnect declined the request for {h.name}: {note}")
        _notify(User.objects.filter(hospital_admin__hospital=h, is_active=True),  # the hospital's admins
                f"connection_{req.status}", title, msg, "/admin")
        return Response(ConnectionRequestSerializer(req).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._decide(request, pk, approve=True)

    @action(detail=True, methods=["post"])
    def decline(self, request, pk=None):
        return self._decide(request, pk, approve=False)


class ConnectedHospitalSerializer(serializers.ModelSerializer):
    account_emails = serializers.SerializerMethodField()
    doctor_count = serializers.IntegerField(read_only=True)
    has_pin = serializers.SerializerMethodField()

    class Meta:
        model = Hospital
        fields = ["id", "name", "city", "address", "phone", "source", "approved_at", "approved_at_estimated",
                  "account_emails", "doctor_count", "has_pin"]

    def get_account_emails(self, h):
        return [a.user.email for a in h.admins.all()]

    def get_has_pin(self, h):
        return h.location is not None


class ConnectedHospitalViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """
    The platform admin's list of connected hospitals (the ones patients can see and book), with Disconnect
    (owner request 2026-11-20). It replaces the old "Add hospital" page: the only way in is now the hospital's
    own sign-up and connection request.
    """

    serializer_class = ConnectedHospitalSerializer
    permission_classes = [IsPlatformAdmin]

    def get_queryset(self):
        from django.db.models import Count, Q

        qs = (Hospital.objects.filter(is_approved=True)
              .annotate(doctor_count=Count("doctors", distinct=True))
              .prefetch_related("admins__user").order_by("name"))
        if q := self.request.query_params.get("q", "").strip():
            qs = qs.filter(Q(name__icontains=q) | Q(city__icontains=q))
        return qs

    @action(detail=True, methods=["post"])
    def disconnect(self, request, pk=None):
        note = str(request.data.get("note", "")).strip()[:500]
        if not note:
            raise ValidationError({"note": "Tell the hospital why, so they can fix it and ask again."})
        with transaction.atomic():
            h = get_object_or_404(Hospital.objects.select_for_update(), pk=pk)
            if not h.is_approved:
                raise ValidationError({"detail": "This hospital isn't connected."})
            h.is_approved = False
            h.save()  # hidden from patients again; the search signal re-indexes it and its doctors
            # Kept with the hospital's connection history, so its dashboard shows why (and "Ask again").
            ConnectionRequest.objects.create(
                hospital=h, status=ConnectionRequest.Status.DISCONNECTED, admin_note=note,
                decided_by=request.user, decided_at=timezone.now())
        _notify(User.objects.filter(hospital_admin__hospital=h, is_active=True), "connection_disconnected",
                "Your hospital was disconnected",
                f"MediConnect disconnected {h.name}: {note} Patients can't find or book it until it's connected again.",
                "/admin")
        return Response({"id": h.id, "connected": False})
