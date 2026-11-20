from rest_framework import serializers

from .models import SupportRequest


class SupportRequestSerializer(serializers.ModelSerializer):
    topic_label = serializers.CharField(source="get_topic_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = SupportRequest
        fields = ["id", "topic", "topic_label", "subject", "message", "status", "status_label", "reply", "created_at", "updated_at"]
        read_only_fields = ["status", "reply", "created_at", "updated_at"]

    def validate_subject(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Write a short subject.")
        return value

    def validate_message(self, value):
        value = value.strip()
        if len(value) < 10:
            raise serializers.ValidationError("Tell us a little more (at least 10 characters).")
        return value


class SupportInboxSerializer(SupportRequestSerializer):
    """The platform admin's view of a message: also who sent it."""

    sender_name = serializers.SerializerMethodField()
    sender_email = serializers.EmailField(source="user.email", read_only=True)
    sender_role = serializers.CharField(source="user.role", read_only=True)

    class Meta(SupportRequestSerializer.Meta):
        fields = SupportRequestSerializer.Meta.fields + ["sender_name", "sender_email", "sender_role"]
        read_only_fields = SupportRequestSerializer.Meta.fields

    def get_sender_name(self, r):
        return r.user.get_full_name() or r.user.email
