from django.http import FileResponse, Http404
from rest_framework import mixins, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import PatientProfile
from apps.accounts.serializers import PatientDetailsSerializer
from apps.accounts.permissions import IsPatient, role_required

from .models import MedicalRecord, RecordAccess, TreatmentNote
from .notes import TreatmentNoteSerializer
from .serializers import MedicalRecordSerializer, RecordAccessSerializer
from .services import RECORD_VIEWER_ROLES, log_access, may_open_records, staff_hospital

NOT_FOUND = "No patient with this ID."
IsRecordViewer = role_required(*RECORD_VIEWER_ROLES)  # doctors and admins


class MyRecordViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """
    A patient's own records.
    GET/POST /api/records/ · GET/PATCH/DELETE /api/records/<id>/ · GET /api/records/access-log/
    Upload with multipart/form-data: title, record_type, record_date (optional), notes (optional), file.
    """

    serializer_class = MedicalRecordSerializer
    permission_classes = [IsPatient]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    http_method_names = ["get", "post", "patch", "delete"]

    def get_queryset(self):
        # Only ever the logged-in patient's records: another patient's id gives 404.
        return MedicalRecord.objects.filter(patient=self.request.user)

    @action(detail=False, url_path="access-log")
    def access_log(self, request):
        """Who opened this patient's records, newest first (last 50)."""
        entries = RecordAccess.objects.filter(patient=request.user)[:50]
        return Response(RecordAccessSerializer(entries, many=True).data)


class PatientLookupView(APIView):
    """
    GET /api/records/patients/<patient_id>/ (doctors and admins)
    The patient ID is a general ID: any doctor or admin gets the patient's name and records with it.
    Every lookup is written to the patient's access log; lookups are limited to 30 a minute per account.
    """

    permission_classes = [IsRecordViewer]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "record_lookup"

    def get(self, request, patient_id):
        profile = (
            PatientProfile.objects.select_related("user")
            .filter(patient_id=patient_id.strip().upper(), user__role="patient", user__is_active=True)
            .first()
        )
        if profile is None:
            return Response({"detail": NOT_FOUND}, status=404)

        patient = profile.user
        hospital = staff_hospital(request.user)  # for the log only; a viewer without a hospital is allowed too
        log_access(viewer=request.user, patient=patient, hospital=hospital, action=RecordAccess.Action.VIEW_LIST)
        records = MedicalRecord.objects.filter(patient=patient)
        return Response({
            "patient": {
                "patient_id": profile.patient_id,
                "name": patient.get_full_name() or patient.email,
            },
            # Age, gender, body details, allergies, conditions, medicines, emergency contact (read-only here).
            "details": PatientDetailsSerializer(profile).data,
            "hospital": hospital.name if hospital else None,  # the viewer's hospital, shown on the page
            "records": MedicalRecordSerializer(records, many=True).data,
            # Treatment notes from every doctor, newest first (part of this logged lookup).
            "notes": TreatmentNoteSerializer(
                TreatmentNote.objects.filter(patient=patient).select_related("appointment"), many=True).data,
        })


class RecordFileView(APIView):
    """
    GET /api/records/<id>/file/ — the file itself, for its patient, or any doctor or admin (logged).
    Other patients get 404, as if the record didn't exist.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        record = MedicalRecord.objects.select_related("patient").filter(pk=pk).first()
        if record is None:
            raise Http404
        user = request.user
        if user.role == "patient" and record.patient_id == user.id:
            pass
        elif may_open_records(user):
            log_access(viewer=user, patient=record.patient, hospital=staff_hospital(user),
                       action=RecordAccess.Action.DOWNLOAD, record=record)
        else:
            raise Http404

        response = FileResponse(
            record.file.open("rb"),
            as_attachment=True,  # always a download, never rendered on the API's own site
            filename=record.original_name,
            content_type=record.content_type,
        )
        response["Cache-Control"] = "private, no-store"
        return response


class TreatmentNoteViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.RetrieveModelMixin,
                           mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    Treatment notes (reference design, Part 3).
    GET  /api/records/notes/                — a patient: their own notes; a doctor: the notes they wrote
                                              (?appointment=<id> for one visit).
    POST /api/records/notes/                — the visit's doctor writes the note (one per visit).
    PATCH /api/records/notes/<id>/          — only the doctor who wrote it.
    Other doctors and admins read notes through the logged patient-ID lookup (PatientLookupView).
    """

    serializer_class = TreatmentNoteSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch"]

    def get_queryset(self):
        user = self.request.user
        qs = TreatmentNote.objects.select_related("appointment")
        if user.role == "patient":
            return qs.filter(patient=user)
        if user.role == "doctor":
            qs = qs.filter(doctor__user=user)
            if appt := self.request.query_params.get("appointment"):
                qs = qs.filter(appointment_id=appt)
            return qs
        return qs.none()

    def create(self, request, *args, **kwargs):
        if request.user.role != "doctor":
            raise PermissionDenied("Only the visit's doctor writes its treatment note.")
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        appt = serializer.validated_data["appointment"]
        doctor = appt.doctor
        serializer.save(patient=appt.patient, doctor=doctor, doctor_name=str(doctor),
                        hospital_name=doctor.hospital.name if doctor.hospital else "")

    def update(self, request, *args, **kwargs):
        if request.user.role != "doctor":
            raise PermissionDenied("Only the doctor who wrote this note can change it.")
        kwargs["partial"] = True
        return super().update(request, *args, **kwargs)
