from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .models import Notification
from .realtime import user_group

UNAUTHORIZED = 4401  # custom close code: frontend refreshes the token and reconnects


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    """One instance per open browser tab. Joins the user's group and forwards pushes."""

    async def connect(self):
        user = self.scope["user"]
        if not user.is_authenticated:
            # Accept first, then close: closing before accept becomes a plain HTTP 403
            # and the browser never sees our 4401 code (so it wouldn't know to refresh the token).
            await self.accept()
            await self.close(code=UNAUTHORIZED)
            return
        self.group = user_group(user.id)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.send_json({"type": "hello", "unread": await self.unread_count()})

    async def disconnect(self, code):
        if hasattr(self, "group"):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive_json(self, content):
        if content.get("type") == "ping":  # keep-alive from the browser
            await self.send_json({"type": "pong"})

    async def notify(self, event):
        """Called for group_send(..., {"type": "notify", "payload": ...})."""
        await self.send_json(event["payload"])

    @database_sync_to_async
    def unread_count(self):
        return Notification.objects.filter(user=self.scope["user"], is_read=False).count()
