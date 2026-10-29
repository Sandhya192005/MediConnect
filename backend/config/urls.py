from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.appointments.views import AppointmentViewSet
from apps.hospitals.views import DepartmentViewSet, HospitalViewSet


def health(request):
    return JsonResponse({"status": "ok"})


router = DefaultRouter()
router.register("hospitals", HospitalViewSet, basename="hospital")
router.register("departments", DepartmentViewSet, basename="department")
router.register("appointments", AppointmentViewSet, basename="appointment")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/doctors/", include("apps.doctors.urls")),
    path("api/", include(router.urls)),
]
