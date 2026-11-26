"""
Patient management for a hospital account (owner request 2026-11-21): everything about its patients in one
place — add a patient, see and edit their details, upload and delete medical records.

- The hospital's patient list = patients it added (HospitalPatient) + everyone with a visit booked there.
- Add a patient by patient ID (already on MediConnect), or create a new one: name and phone, optional email,
  date of birth and gender. No password and no email are sent: hospitals and doctors open records by
  patient ID. A patient with an email can claim the account later with "Forgot password?".
- Any patient can be OPENED by patient ID (the general patient ID rule; every view is logged for the
  patient). Editing details and uploading records needs the patient to be in the hospital's list.
- Records the hospital uploads show in the patient's own records ("Uploaded by <hospital>"); each side's
  Delete only removes its own copy (records/services.py).
"""

import uuid

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import NO_EMAIL_DOMAIN, PatientProfile
from apps.accounts.permissions import IsHospitalAdmin
from apps.accounts.serializers import PatientDetailsSerializer
from apps.appointments.models import Appointment
from apps.records.models import MedicalRecord, RecordAccess
from apps.records.serializers import MedicalRecordSerializer
from apps.records.services import delete_for_hospital, log_access, records_visible_to

from .models import HospitalPatient

User = get_user_model()
GENDERS = [c[0] for c in PatientProfile._meta.get_field("gender").choices]


def in_hospital_list(hospital, patient) -> bool:
    from apps.records.services import RELATED_STATUSES

    return (HospitalPatient.objects.filter(hospital=hospital, patient=patient).exists()
            or Appointment.objects.filter(patient=patient, doctor__hospital=hospital, status__in=RELATED_STATUSES).exists())


def _profile_by_id(patient_id: str) -> PatientProfile:
    profile = (PatientProfile.objects.select_related("user")
               .filter(patient_id=str(patient_id).strip().upper(), user__role="patient", user__is_active=True).first())
    if profile is None:
        raise NotFound("No patient with this ID.")
    return profile


def _clean_phone(value: str) -> str:
    value = value.strip()
    digits = sum(c.isdigit() for c in value)
    if value and (not all(c.isdigit() or c in "+- ()" for c in value) or not 7 <= digits <= 15):
        raise serializers.ValidationError("Enter a phone number of 7 to 15 digits.")
    return value


class NewPatientSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    phone = serializers.CharField(max_length=20)
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    date_of_birth = serializers.DateField(required=False, allow_null=True, default=None)
    gender = serializers.ChoiceField(choices=GENDERS, required=False, allow_blank=True, default="")

    def validate_first_name(self, v):
        v = " ".join(v.split())
        if not v:
            raise serializers.ValidationError("Enter the patient's name.")
        return v

    def validate_phone(self, v):
        v = _clean_phone(v)
        if not v:
            raise serializers.ValidationError("Enter a phone number, so you can reach the patient.")
        return v

    def validate_email(self, v):
        v = User.objects.normalize_email(v).lower().strip() if v else ""
        if v and User.objects.filter(email__iexact=v).exists():
            # Never reveal whose account it is: the hospital asks the patient for their ID.
            raise serializers.ValidationError(
                "This email already has a MediConnect account. Ask the patient for their patient ID and add them by ID.")
        return v

    def validate_date_of_birth(self, v):
        if v and v > timezone.localdate():
            raise serializers.ValidationError("The date of birth can't be in the future.")
        return v


def may_edit_email(hospital, p) -> bool:
    """
    The hospital may set or change the email of a patient with none yet, or of a patient it created who hasn't
    started using the app (no password): the email is just what its staff typed (owner request 2026-11-22).
    Once the patient logs in themselves, the email is theirs.
    """
    if not p.has_real_email:
        return True
    created = HospitalPatient.objects.filter(hospital=hospital, patient=p, created_account=True).exists()
    return created and not p.has_usable_password()


def pick_visit(set_on, next_start, last_done):
    """
    The patient's visit date and status (owner requests 2026-11-22): the date the hospital set; otherwise
    today's or the next upcoming appointment here, else the last completed one. Status from the date:
    before today = past, today = current, after today = upcoming.
    """
    on = set_on or (timezone.localtime(next_start).date() if next_start else None) or (
        timezone.localtime(last_done).date() if last_done else None)
    if on is None:
        return {"visit_on": None, "visit_status": None, "visit_set_by_you": False}
    today = timezone.localdate()
    status = "past" if on < today else "current" if on == today else "upcoming"
    return {"visit_on": on, "visit_status": status, "visit_set_by_you": bool(set_on)}


def visit_of(hospital, p, link) -> dict:
    from apps.appointments.models import ACTIVE_STATUSES
    from apps.appointments.queue import day_bounds

    here = Appointment.objects.filter(patient=p, doctor__hospital=hospital)
    start_of_today, _ = day_bounds()
    next_start = (here.filter(status__in=ACTIVE_STATUSES, start__gte=start_of_today)
                  .order_by("start").values_list("start", flat=True).first())
    last_done = (here.filter(status=Appointment.Status.COMPLETED).order_by("-start").values_list("start", flat=True).first())
    return pick_visit(link.visited_on if link else None, next_start, last_done)


def patient_row(p, hospital) -> dict:
    """One patient in the detail view's header."""
    link = HospitalPatient.objects.filter(hospital=hospital, patient=p).first()
    return {
        "can_edit_email": may_edit_email(hospital, p),
        **visit_of(hospital, p, link),
        "patient_id": p.patient_profile.patient_id,
        "name": p.get_full_name() or "Patient",
        "first_name": p.first_name, "last_name": p.last_name,
        "email": p.email if p.has_real_email else None,
        "phone": p.phone,
        "has_login": p.has_usable_password(),
        "in_list": link is not None or in_hospital_list(hospital, p),
        "added_by_you": link is not None,
        "created_by_you": bool(link and link.created_account),
    }


class PatientManageView(APIView):
    """
    GET    /api/hospital-admin/patients/<patient_id>/ — the patient's page (logged for the patient).
    PATCH  … — name, phone, email (only if none yet) and health details (patients in your list).
    DELETE … — remove from your list (only patients you added; the account stays).
    """

    permission_classes = [IsHospitalAdmin]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "record_lookup"

    def get_throttles(self):
        return super().get_throttles() if self.request.method == "GET" else []

    def payload(self, request, profile):
        hospital, p = request.admin_hospital, profile.user
        records = records_visible_to(request.user, p).select_related("uploaded_by_hospital")
        visits = (Appointment.objects.filter(patient=p, doctor__hospital=hospital)
                  .select_related("doctor__user").order_by("-start")[:20])
        return {
            "patient": patient_row(p, hospital),
            "details": PatientDetailsSerializer(profile).data,
            "records": [{**MedicalRecordSerializer(r).data, "can_delete": r.uploaded_by_hospital_id == hospital.id}
                        for r in records],
            "visits": [{"id": a.id, "start": a.start, "doctor_name": str(a.doctor), "status": a.status, "reason": a.reason}
                       for a in visits],
        }

    def get(self, request, patient_id):
        profile = _profile_by_id(patient_id)
        log_access(viewer=request.user, patient=profile.user, hospital=request.admin_hospital,
                   action=RecordAccess.Action.VIEW_LIST)
        return Response(self.payload(request, profile))

    def patch(self, request, patient_id):
        profile = _profile_by_id(patient_id)
        p, hospital = profile.user, request.admin_hospital
        if not in_hospital_list(hospital, p):
            raise PermissionDenied("Add this patient to your patients first.")
        data = request.data
        changed = []
        with transaction.atomic():
            if "first_name" in data:
                name = " ".join(str(data["first_name"]).split())[:150]
                if not name:
                    raise ValidationError({"first_name": "Enter the patient's name."})
                p.first_name = name
                changed.append("first_name")
            if "last_name" in data:
                p.last_name = " ".join(str(data["last_name"]).split())[:150]
                changed.append("last_name")
            if "phone" in data:
                try:
                    p.phone = _clean_phone(str(data["phone"]))[:20]
                except serializers.ValidationError as e:
                    raise ValidationError({"phone": e.detail})
                changed.append("phone")
            if data.get("email") and data["email"].strip().lower() != (p.email if p.has_real_email else ""):
                if not may_edit_email(hospital, p):
                    raise ValidationError({"email": "The patient changes their own email in their account."})
                email = User.objects.normalize_email(str(data["email"])).lower().strip()
                serializers.EmailField().run_validation(email)
                if User.objects.filter(email__iexact=email).exclude(pk=p.pk).exists():
                    raise ValidationError({"email": "This email already has a MediConnect account."})
                p.email = email
                changed.append("email")
            if changed:
                p.save(update_fields=changed)
            if "visit_on" in data:  # past, today or upcoming (owner request 2026-11-22)
                visited = None
                if data["visit_on"]:
                    try:
                        visited = timezone.datetime.fromisoformat(str(data["visit_on"])).date()
                    except ValueError:
                        raise ValidationError({"visit_on": "Use a date like 2026-11-22."})
                # A patient listed through a booking gets a link row to keep the date on.
                link, _ = HospitalPatient.objects.get_or_create(hospital=hospital, patient=p, defaults={"added_by": request.user})
                link.visited_on = visited
                link.save(update_fields=["visited_on"])
            detail_fields = {k: v for k, v in data.items() if k in PatientDetailsSerializer.Meta.fields}
            if detail_fields:
                s = PatientDetailsSerializer(profile, data=detail_fields, partial=True)
                s.is_valid(raise_exception=True)
                s.save()
        profile.refresh_from_db()
        return Response(self.payload(request, profile))

    def delete(self, request, patient_id):
        profile = _profile_by_id(patient_id)
        deleted, _ = HospitalPatient.objects.filter(hospital=request.admin_hospital, patient=profile.user).delete()
        if not deleted:
            raise ValidationError({"detail": "Only patients you added can be removed; patients with visits here stay listed."})
        return Response(status=204)


class PatientAddView(APIView):
    """
    POST /api/hospital-admin/patients/ — add a patient:
      {patient_id}                      a patient already on MediConnect;
      {first_name, phone, last_name?, email?, date_of_birth?, gender?}   a new patient (account created).
    """

    permission_classes = [IsHospitalAdmin]

    def post(self, request):
        hospital = request.admin_hospital
        if pid := str(request.data.get("patient_id", "")).strip():
            profile = _profile_by_id(pid)
            _, created = HospitalPatient.objects.get_or_create(hospital=hospital, patient=profile.user,
                                                               defaults={"added_by": request.user})
            return Response({"patient_id": profile.patient_id, "already": not created}, status=201 if created else 200)

        s = NewPatientSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        with transaction.atomic():
            email = d["email"] or f"patient-{uuid.uuid4().hex[:16]}@{NO_EMAIL_DOMAIN}"
            user = User.objects.create_user(email, None, role="patient", first_name=d["first_name"],
                                            last_name=" ".join(d["last_name"].split()), phone=d["phone"])  # no password
            profile = PatientProfile.for_user(user)
            profile.date_of_birth, profile.gender = d["date_of_birth"], d["gender"]
            profile.save(update_fields=["date_of_birth", "gender"])
            HospitalPatient.objects.create(hospital=hospital, patient=user, created_account=True, added_by=request.user)
        return Response({"patient_id": profile.patient_id, "already": False}, status=201)


class PatientRecordsView(APIView):
    """POST /api/hospital-admin/patients/<patient_id>/records/ — upload a record (multipart) for a patient in your list."""

    permission_classes = [IsHospitalAdmin]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request, patient_id):
        profile = _profile_by_id(patient_id)
        hospital, p = request.admin_hospital, profile.user
        if not in_hospital_list(hospital, p):
            raise PermissionDenied("Add this patient to your patients first.")
        s = MedicalRecordSerializer(data=request.data, context={"request": request, "patient": p, "hospital": hospital})
        s.is_valid(raise_exception=True)
        record = s.save()

        def tell_patient():
            from apps.notifications.realtime import create_notification

            create_notification(p, "record_added", "New medical record",
                                f"{hospital.name} added “{record.title}” to your records.", "/patient/records")

        transaction.on_commit(tell_patient)
        return Response({**MedicalRecordSerializer(record).data, "can_delete": True}, status=201)


class PatientRecordDeleteView(APIView):
    """DELETE /api/hospital-admin/patients/<patient_id>/records/<id>/ — your own upload; the patient keeps their copy."""

    permission_classes = [IsHospitalAdmin]

    def delete(self, request, patient_id, pk):
        profile = _profile_by_id(patient_id)
        record = MedicalRecord.objects.filter(pk=pk, patient=profile.user, uploaded_by_hospital=request.admin_hospital,
                                              hidden_for_hospital=False).first()
        if record is None:
            raise NotFound("You can only delete records your hospital uploaded.")
        delete_for_hospital(record)
        return Response(status=204)


def hospital_patient_q(hospital):
    """Filter for users who are this hospital's patients: added by it, or with a visit booked there."""
    from apps.records.services import RELATED_STATUSES

    return (Q(appointments__doctor__hospital=hospital, appointments__status__in=RELATED_STATUSES)
            | Q(hospital_links__hospital=hospital))
