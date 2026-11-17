from rest_framework.routers import SimpleRouter

from .views import SupportRequestViewSet

router = SimpleRouter()
router.register("", SupportRequestViewSet, basename="support")

urlpatterns = router.urls
