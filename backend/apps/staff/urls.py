from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.hospitals.connections import HospitalConnectionView

from .views import DoctorAccountsView, OverviewView, PatientsView, PayrollView, StaffViewSet

router = SimpleRouter()
router.register("staff", StaffViewSet, basename="staff")

urlpatterns = [
    path("overview/", OverviewView.as_view(), name="hospital-admin-overview"),
    path("patients/", PatientsView.as_view(), name="hospital-admin-patients"),
    path("payroll/", PayrollView.as_view(), name="hospital-admin-payroll"),
    path("connection/", HospitalConnectionView.as_view(), name="hospital-admin-connection"),
    path("doctor-accounts/", DoctorAccountsView.as_view(), name="hospital-admin-doctor-accounts"),
    *router.urls,
]
