from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.hospitals.connections import HospitalConnectionView

from .profile import HospitalProfileView
from .views import DoctorAccountsView, DoctorAppointmentsView, OverviewView, PatientsView, PayrollView, ReportsView, StaffViewSet

router = SimpleRouter()
router.register("staff", StaffViewSet, basename="staff")

urlpatterns = [
    path("overview/", OverviewView.as_view(), name="hospital-admin-overview"),
    path("patients/", PatientsView.as_view(), name="hospital-admin-patients"),
    path("payroll/", PayrollView.as_view(), name="hospital-admin-payroll"),
    path("reports/", ReportsView.as_view(), name="hospital-admin-reports"),
    path("profile/", HospitalProfileView.as_view(), name="hospital-admin-profile"),
    path("doctors/<int:pk>/appointments/", DoctorAppointmentsView.as_view(), name="hospital-admin-doctor-appointments"),
    path("connection/", HospitalConnectionView.as_view(), name="hospital-admin-connection"),
    path("doctor-accounts/", DoctorAccountsView.as_view(), name="hospital-admin-doctor-accounts"),
    *router.urls,
]
