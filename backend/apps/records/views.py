from django.http import FileResponse, Http404
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import PatientProfile
from apps.accounts.permissions import IsDoctor, IsPatient

from .models import MedicalRecord, RecordAccess
from .serializers import MedicalRecordSerializer, RecordAccessSerializer
from .services import doctor_hospital_for, log_access

NOT_FOUND = "No patient with this ID has an appointment at your hospital."


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
    GET /api/records/patients/<patient_id>/ (doctors only)
    The patient's name and records, if the patient has had an appointment at the doctor's hospital.
    Every successful lookup is written to the patient's access log.
    Unknown ID and "not your hospital's patient" give the same 404, so IDs can't be probed.
    """

    permission_classes = [IsDoctor]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "record_lookup"

    def get(self, request, patient_id):
        profile = (
            PatientProfile.objects.select_related("user")
            .filter(patient_id=patient_id.strip().upper(), user__role="patient", user__is_active=True)
            .first()
        )
        hospital = doctor_hospital_for(request.user, profile.user) if profile else None
        if hospital is None:
            return Response({"detail": NOT_FOUND}, status=404)

        patient = profile.user
        log_access(viewer=request.user, patient=patient, hospital=hospital, action=RecordAccess.Action.VIEW_LIST)
        records = MedicalRecord.objects.filter(patient=patient)
        return Response({
            "patient": {
                "patient_id": profile.patient_id,
                "name": patient.get_full_name() or patient.email,
            },
            "hospital": hospital.name,
            "records": MedicalRecordSerializer(records, many=True).data,
        })


class RecordFileView(APIView):
    """
    GET /api/records/<id>/file/ — the file itself, for its patient or a permitted doctor (logged).
    Anyone else gets 404, as if the record didn't exist.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        record = MedicalRecord.objects.select_related("patient").filter(pk=pk).first()
        if record is None:
            raise Http404
        user = request.user
        if user.role == "patient" and record.patient_id == user.id:
            pass
        elif user.role == "doctor" and (hospital := doctor_hospital_for(user, record.patient)):
            log_access(viewer=user, patient=record.patient, hospital=hospital,
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
