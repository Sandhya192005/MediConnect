from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.hospitals.connections import HospitalConnectionView

from .patients import PatientAddView, PatientManageView, PatientRecordDeleteView, PatientRecordsView
from .profile import HospitalProfileView
from .views import DoctorAccountsView, DoctorAppointmentsView, OverviewView, PatientsView, PayrollView, ReportsView, StaffViewSet

router = SimpleRouter()
router.register("staff", StaffViewSet, basename="staff")

urlpatterns = [
    path("overview/", OverviewView.as_view(), name="hospital-admin-overview"),
    path("patients/", PatientsView.as_view(), name="hospital-admin-patients"),
    # Patient management (owner request 2026-11-21): add, open, edit; records upload and delete.
    path("patients/add/", PatientAddView.as_view(), name="hospital-admin-patient-add"),
    path("patients/<str:patient_id>/", PatientManageView.as_view(), name="hospital-admin-patient"),
    path("patients/<str:patient_id>/records/", PatientRecordsView.as_view(), name="hospital-admin-patient-records"),
    path("patients/<str:patient_id>/records/<int:pk>/", PatientRecordDeleteView.as_view(),
         name="hospital-admin-patient-record"),
    path("payroll/", PayrollView.as_view(), name="hospital-admin-payroll"),
    path("reports/", ReportsView.as_view(), name="hospital-admin-reports"),
    path("profile/", HospitalProfileView.as_view(), name="hospital-admin-profile"),
    path("doctors/<int:pk>/appointments/", DoctorAppointmentsView.as_view(), name="hospital-admin-doctor-appointments"),
    path("connection/", HospitalConnectionView.as_view(), name="hospital-admin-connection"),
    path("doctor-accounts/", DoctorAccountsView.as_view(), name="hospital-admin-doctor-accounts"),
    *router.urls,
]
