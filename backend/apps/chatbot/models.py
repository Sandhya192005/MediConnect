from django.conf import settings
from django.db import models


class ChatSession(models.Model):
    """One conversation between a user and the assistant."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_sessions")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"Chat {self.id} ({self.user})"


class ChatMessage(models.Model):
    """
    Every message is stored, including the model's tool calls and our tool results,
    so the next turn has full context (e.g. "book the 10 am one" knows which doctor).
    """

    class Role(models.TextChoices):
        USER = "user"
        ASSISTANT = "assistant"
        TOOL = "tool"

    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=10, choices=Role.choices)
    content = models.TextField(blank=True)
    tool_calls = models.JSONField(null=True, blank=True)  # assistant asking to run tools
    tool_call_id = models.CharField(max_length=100, blank=True)  # tool result answering a call
    proposals = models.JSONField(null=True, blank=True)  # booking cards shown under an assistant reply
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def to_openai(self) -> dict:
        msg = {"role": self.role, "content": self.content or ""}
        if self.tool_calls:
            msg["tool_calls"] = self.tool_calls
        if self.role == self.Role.TOOL:
            msg["tool_call_id"] = self.tool_call_id
        return msg
