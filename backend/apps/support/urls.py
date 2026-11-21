from rest_framework.routers import SimpleRouter

from .views import SupportInboxViewSet, SupportRequestViewSet

router = SimpleRouter()
# The inbox first: otherwise "inbox" would be read as a request id by the user's own routes.
router.register("inbox", SupportInboxViewSet, basename="support-inbox")
router.register("", SupportRequestViewSet, basename="support")

urlpatterns = router.urls
