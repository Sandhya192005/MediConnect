from datetime import time, timedelta

import pytest
from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.doctors.models import DoctorProfile, WeeklyAvailability
from apps.hospitals.models import Hospital

from .middleware import JwtAuthMiddleware
from .models import Notification
from .realtime import create_notification
from .routing import websocket_urlpatterns

User = get_user_model()
ws_app = JwtAuthMiddleware(URLRouter(websocket_urlpatterns))


@pytest.fixture
def doctor():
    user = User.objects.create_user("doc@example.com", "pw", role="doctor", first_name="Doc")
    profile = DoctorProfile.objects.get(user=user)
    profile.hospital = Hospital.objects.create(name="Test Hospital", city="Chennai")
    profile.save()
    for wd in range(7):
        WeeklyAvailability.objects.create(doctor=profile, weekday=wd, start_time=time(0), end_time=time(23, 45))
    return profile


@pytest.mark.django_db
def test_booking_creates_bell_notifications(doctor, django_capture_on_commit_callbacks):
    patient = User.objects.create_user("pat@example.com", "pw", first_name="Pat")
    c = APIClient()
    c.force_authenticate(patient)
    day = (timezone.localdate() + timedelta(days=2)).isoformat()
    slot = c.get(f"/api/doctors/{doctor.id}/slots/?date={day}").data["slots"][4]["start"]
    with django_capture_on_commit_callbacks(execute=True):
        c.post("/api/appointments/", {"doctor": doctor.id, "start": slot}, format="json")

    assert Notification.objects.get(user=patient).title == "Appointment booked"
    assert Notification.objects.get(user=doctor.user).title == "New booking"

    # REST: list, mark one read, mark all read
    res = c.get("/api/notifications/")
    assert res.data["unread"] == 1
    n_id = res.data["results"][0]["id"]
    assert c.post(f"/api/notifications/{n_id}/read/").data["unread"] == 0

    # Users can't touch other people's notifications
    other = Notification.objects.get(user=doctor.user)
    assert c.post(f"/api/notifications/{other.id}/read/").status_code == 404


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_websocket_receives_live_notification():
    user = await database_sync_to_async(User.objects.create_user)("live@example.com", "pw")
    token = str(AccessToken.for_user(user))

    ws = WebsocketCommunicator(ws_app, f"/ws/notifications/?token={token}")
    connected, _ = await ws.connect()
    assert connected
    assert await ws.receive_json_from() == {"type": "hello", "unread": 0}

    await database_sync_to_async(create_notification)(user, "test", "Hello", "Live message")
    msg = await ws.receive_json_from(timeout=2)
    assert msg["type"] == "notification"
    assert msg["notification"]["title"] == "Hello"
    assert msg["unread"] == 1

    await ws.send_json_to({"type": "ping"})
    assert await ws.receive_json_from() == {"type": "pong"}
    await ws.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_websocket_rejects_missing_or_bad_token():
    for url in ["/ws/notifications/", "/ws/notifications/?token=not-a-jwt"]:
        ws = WebsocketCommunicator(ws_app, url)
        await ws.connect()
        closed = await ws.receive_output()
        assert closed == {"type": "websocket.close", "code": 4401}
