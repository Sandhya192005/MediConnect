from rest_framework.routers import SimpleRouter

from .views import HospitalPaymentViewSet, MyPaymentViewSet

# /api/hospital-admin/payments/… (included before the staff URLs) and /api/payments/…
hospital_router = SimpleRouter()
hospital_router.register("", HospitalPaymentViewSet, basename="hospital-payment")

patient_router = SimpleRouter()
patient_router.register("", MyPaymentViewSet, basename="my-payment")

hospital_urlpatterns = hospital_router.urls
patient_urlpatterns = patient_router.urls
