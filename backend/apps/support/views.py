from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import transaction
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from apps.accounts.permissions import IsPlatformAdmin

from .models import SupportRequest
from .serializers import SupportInboxSerializer, SupportRequestSerializer

User = get_user_model()


def _notify_later(users, kind, title, message, link):
    """In-app notifications, sent once the database change is saved."""
    from apps.notifications.realtime import create_notification

    users = list(users)
    transaction.on_commit(lambda: [create_notification(u, kind, title, message[:300], link=link) for u in users])


class SupportRequestViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.RetrieveModelMixin,
                            viewsets.GenericViewSet):
    """
    GET/POST /api/support/ — your own support requests (anyone logged in). Sending is limited to 10 an hour.
    The platform admin answers in the Support inbox (/api/support/inbox/); the reply shows here and as a notification.
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
        who = user.get_full_name() or user.email
        body = (
            f"From: {who} <{user.email}> ({user.role})\n"
            f"Topic: {req.get_topic_display()}\n\n{req.message}\n\n"
            f"Answer it in MediConnect: Support inbox (/admin/support)."
        )
        # Tell the support inbox (Mailpit locally). Best effort: a mail problem never loses the request.
        transaction.on_commit(lambda: send_mail(f"[Support #{req.pk}] {req.subject}", body,
                                                settings.DEFAULT_FROM_EMAIL, [settings.SUPPORT_EMAIL],
                                                fail_silently=True))
        # And the platform admins, in the app (owner request 2026-11-20); not the sender, if they are one.
        _notify_later(User.objects.filter(is_superuser=True, is_active=True).exclude(pk=user.pk), "support_request",
                      "New support message", f"{who} ({user.role}): {req.subject}", "/admin/support")


class SupportInboxViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """
    The platform admin's Support inbox (owner request 2026-11-20), replacing replies in Django admin.

    GET  /api/support/inbox/?status=open|closed
    POST /api/support/inbox/<id>/reply/  {reply}  — closes the message; the sender gets a notification
    POST /api/support/inbox/<id>/status/ {status}              — close or reopen
    """

    serializer_class = SupportInboxSerializer
    permission_classes = [IsPlatformAdmin]

    def get_queryset(self):
        qs = SupportRequest.objects.select_related("user")
        if status := self.request.query_params.get("status"):
            qs = qs.filter(status=status)
        return qs

    @action(detail=True, methods=["post"])
    def reply(self, request, pk=None):
        req = self.get_object()
        text = str(request.data.get("reply", "")).strip()
        if not text:
            raise ValidationError({"reply": "Write your answer."})
        if len(text) > 4000:
            raise ValidationError({"reply": "That's too long (4000 characters at most)."})
        req.reply = text
        req.status = SupportRequest.Status.CLOSED  # one reply per message, so replying closes it (2026-11-25)
        req.save(update_fields=["reply", "status", "updated_at"])
        _notify_later([req.user], "support_reply", "Support replied", f"{req.subject}: {text[:200]}", "/support")
        return Response(self.get_serializer(req).data)

    @action(detail=True, methods=["post"])
    def status(self, request, pk=None):
        req = self.get_object()
        value = request.data.get("status")
        if value not in SupportRequest.Status.values:
            raise ValidationError({"status": "Use open or closed."})
        req.status = value
        req.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(req).data)
