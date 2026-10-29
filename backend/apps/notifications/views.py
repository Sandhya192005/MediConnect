from rest_framework.decorators import api_view
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response

from .models import Notification
from .serializers import NotificationSerializer


@api_view(["GET"])
def notification_list(request):
    """Latest 30 notifications plus the unread count."""
    qs = Notification.objects.filter(user=request.user)
    return Response({
        "unread": qs.filter(is_read=False).count(),
        "results": NotificationSerializer(qs[:30], many=True).data,
    })


@api_view(["POST"])
def mark_read(request, pk):
    n = get_object_or_404(Notification, pk=pk, user=request.user)
    n.is_read = True
    n.save(update_fields=["is_read"])
    return Response({"unread": Notification.objects.filter(user=request.user, is_read=False).count()})


@api_view(["POST"])
def mark_all_read(request):
    Notification.objects.filter(user=request.user, is_read=False).update(is_read=True)
    return Response({"unread": 0})
