import os

from django.utils import timezone
from rest_framework import serializers

from .models import MedicalRecord, RecordAccess
from .services import check_upload


class MedicalRecordSerializer(serializers.ModelSerializer):
    record_type_label = serializers.CharField(source="get_record_type_display", read_only=True)
    # Upload only: the file itself is never part of a JSON response (download it from /file/).
    file = serializers.FileField(write_only=True)

    class Meta:
        model = MedicalRecord
        fields = [
            "id", "title", "record_type", "record_type_label", "record_date", "notes",
            "file", "original_name", "content_type", "size", "created_at",
        ]
        read_only_fields = ["original_name", "content_type", "size", "created_at"]

    def get_fields(self):
        fields = super().get_fields()
        if self.instance is not None:  # editing: the details can change, the file can't (upload a new record)
            fields.pop("file")
        return fields

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Give the record a title.")
        return value

    def validate_record_date(self, value):
        if value and value > timezone.localdate():
            raise serializers.ValidationError("The date can't be in the future.")
        return value

    def validate_file(self, file):
        self._content_type = check_upload(file)
        return file

    def create(self, validated_data):
        file = validated_data["file"]
        request = self.context["request"]
        return MedicalRecord.objects.create(
            **validated_data,
            patient=request.user,
            uploaded_by=request.user,
            original_name=os.path.basename(file.name)[:255],
            content_type=self._content_type,
            size=file.size,
        )


class RecordAccessSerializer(serializers.ModelSerializer):
    action_label = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = RecordAccess
        fields = ["id", "viewer_name", "hospital_name", "record_title", "action", "action_label", "created_at"]
