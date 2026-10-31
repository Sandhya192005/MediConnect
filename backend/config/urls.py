from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.appointments.external_api import ExternalAppointmentViewSet
from apps.appointments.requests_api import AppointmentRequestViewSet
from apps.appointments.views import AppointmentViewSet
from apps.hospitals.views import DepartmentViewSet, HospitalViewSet


def health(request):
    return JsonResponse({"status": "ok"})


router = DefaultRouter()
router.register("hospitals", HospitalViewSet, basename="hospital")
router.register("departments", DepartmentViewSet, basename="department")
router.register("appointments", AppointmentViewSet, basename="appointment")
router.register("appointment-requests", AppointmentRequestViewSet, basename="appointment-request")
router.register("external-appointments", ExternalAppointmentViewSet, basename="external-appointment")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/doctors/", include("apps.doctors.urls")),
    path("api/notifications/", include("apps.notifications.urls")),
    path("api/search/", include("apps.search.urls")),
    path("api/chat/", include("apps.chatbot.urls")),
    path("api/scraper/", include("apps.scraper.urls")),
    path("api/", include(router.urls)),
]
