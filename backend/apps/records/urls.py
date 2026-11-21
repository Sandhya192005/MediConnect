from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import MyRecordViewSet, PatientLookupView, RecordFileView, TreatmentNoteViewSet

notes = SimpleRouter()
notes.register("notes", TreatmentNoteViewSet, basename="treatment-note")
router = SimpleRouter()
router.register("", MyRecordViewSet, basename="record")

urlpatterns = [
    path("patients/<str:patient_id>/", PatientLookupView.as_view(), name="record-patient-lookup"),
    path("<int:pk>/file/", RecordFileView.as_view(), name="record-file"),
    *notes.urls,  # before the records router: its "<pk>/" would otherwise catch "notes/"
    *router.urls,
]
