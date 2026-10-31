import logging

import openai
from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response

from . import service
from .models import ChatSession
from .safety import EMERGENCY_NOTICE, check_rate_limit, is_emergency

log = logging.getLogger(__name__)


class LocationSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)


class ChatInputSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=1000, trim_whitespace=True)
    session_id = serializers.IntegerField(required=False, allow_null=True)
    location = LocationSerializer(required=False, allow_null=True)


def _unavailable(msg):
    return Response({"detail": msg}, status=status.HTTP_503_SERVICE_UNAVAILABLE)


@api_view(["POST"])
def chat(request):
    """POST /api/chat/ {message, session_id?, location?: {lat, lng}}"""
    data = ChatInputSerializer(data=request.data)
    data.is_valid(raise_exception=True)
    d = data.validated_data

    if not check_rate_limit(request.user.id):
        return Response({"detail": "You're sending messages too quickly. Please wait a few minutes."}, status=429)

    if d.get("session_id"):
        session = get_object_or_404(ChatSession, pk=d["session_id"], user=request.user)
    else:
        session = ChatSession.objects.create(user=request.user)

    try:
        result = service.chat(request.user, session, d["message"], d.get("location"))
    except service.ChatNotConfigured:
        return _unavailable("The assistant isn't set up yet (missing OpenAI API key).")
    except openai.AuthenticationError:
        log.error("OpenAI rejected the API key")
        return _unavailable("The assistant isn't set up correctly (invalid OpenAI API key).")
    except openai.RateLimitError:
        return _unavailable("The assistant is busy or out of credits. Please try again later.")
    except openai.OpenAIError as e:
        log.warning("OpenAI error: %s", e)
        return _unavailable("The assistant is temporarily unavailable. Please try again.")

    emergency = is_emergency(d["message"])
    return Response({
        "session_id": session.id,
        "reply": result["reply"],
        "proposals": result["proposals"],
        "emergency": emergency,
        "emergency_notice": EMERGENCY_NOTICE if emergency else None,
    })


@api_view(["GET"])
def history(request):
    """GET /api/chat/history/?session_id=  (default: the user's latest chat). Only user/assistant text."""
    sid = request.query_params.get("session_id")
    sessions = ChatSession.objects.filter(user=request.user)
    session = get_object_or_404(sessions, pk=sid) if sid else sessions.first()
    if not session:
        return Response({"session_id": None, "messages": []})
    msgs = session.messages.filter(role__in=["user", "assistant"]).exclude(content="")
    return Response({
        "session_id": session.id,
        "messages": [
            {"role": m.role, "content": m.content, "proposals": m.proposals or [], "created_at": m.created_at}
            for m in msgs
            if not (m.role == "assistant" and m.tool_calls)
        ],
    })
