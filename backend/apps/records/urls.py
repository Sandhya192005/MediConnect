from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import MyRecordViewSet, PatientLookupView, RecordFileView

router = SimpleRouter()
router.register("", MyRecordViewSet, basename="record")

urlpatterns = [
    path("patients/<str:patient_id>/", PatientLookupView.as_view(), name="record-patient-lookup"),
    path("<int:pk>/file/", RecordFileView.as_view(), name="record-file"),
    *router.urls,
]
