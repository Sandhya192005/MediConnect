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
