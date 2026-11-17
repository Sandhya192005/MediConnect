from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from rest_framework import mixins, viewsets
from rest_framework.throttling import ScopedRateThrottle

from .models import SupportRequest
from .serializers import SupportRequestSerializer


class SupportRequestViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.RetrieveModelMixin,
                            viewsets.GenericViewSet):
    """
    GET/POST /api/support/ — your own support requests (anyone logged in). Sending is limited to 10 an hour.
    The platform admin answers in Django admin; the reply shows here and as a notification.
    """

    serializer_class = SupportRequestSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "support"

    def get_queryset(self):
        return SupportRequest.objects.filter(user=self.request.user)

    def get_throttles(self):
        return super().get_throttles() if self.request.method == "POST" else []  # reading isn't limited

    def perform_create(self, serializer):
        req = serializer.save(user=self.request.user)
        user = self.request.user
        body = (
            f"From: {user.get_full_name() or user.email} <{user.email}> ({user.role})\n"
            f"Topic: {req.get_topic_display()}\n\n{req.message}\n\n"
            f"Answer it in Django admin: Support requests → #{req.pk}"
        )
        # Tell the support inbox (Mailpit locally). Best effort: a mail problem never loses the request.
        transaction.on_commit(lambda: send_mail(f"[Support #{req.pk}] {req.subject}", body,
                                                settings.DEFAULT_FROM_EMAIL, [settings.SUPPORT_EMAIL],
                                                fail_silently=True))
