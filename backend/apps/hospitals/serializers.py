from django.contrib.gis.geos import Point
from rest_framework import serializers

from .models import Department, Hospital


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ["id", "name", "description"]


class HospitalSerializer(serializers.ModelSerializer):
    # Expose the PostGIS point as plain lat/lng numbers.
    latitude = serializers.FloatField(required=False, allow_null=True)
    longitude = serializers.FloatField(required=False, allow_null=True)
    departments = DepartmentSerializer(many=True, read_only=True)
    department_ids = serializers.PrimaryKeyRelatedField(
        queryset=Department.objects.all(), many=True, write_only=True, required=False, source="departments"
    )

    class Meta:
        model = Hospital
        fields = [
            "id", "name", "address", "city", "state", "country", "phone", "website",
            "latitude", "longitude", "departments", "department_ids", "source", "is_approved",
        ]
        read_only_fields = ["source"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["latitude"] = instance.location.y if instance.location else None
        data["longitude"] = instance.location.x if instance.location else None
        return data

    def _apply_location(self, validated_data):
        lat = validated_data.pop("latitude", None)
        lng = validated_data.pop("longitude", None)
        if lat is not None and lng is not None:
            validated_data["location"] = Point(lng, lat, srid=4326)

    def create(self, validated_data):
        self._apply_location(validated_data)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        self._apply_location(validated_data)
        return super().update(instance, validated_data)
