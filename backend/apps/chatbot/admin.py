from django.contrib import admin

from .models import ChatMessage, ChatSession


class MessageInline(admin.TabularInline):
    model = ChatMessage
    extra = 0
    fields = ["role", "content", "tool_calls", "created_at"]
    readonly_fields = fields
    can_delete = False


@admin.register(ChatSession)
class ChatSessionAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "created_at", "updated_at"]
    search_fields = ["user__email"]
    inlines = [MessageInline]
