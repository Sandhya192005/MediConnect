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
            "latitude", "longitude", "location_verified", "departments", "department_ids",
            "source", "is_approved",
        ]
        read_only_fields = ["source"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["latitude"] = instance.location.y if instance.location else None
        data["longitude"] = instance.location.x if instance.location else None
        return data

    def validate(self, attrs):
        lat, lng = attrs.get("latitude"), attrs.get("longitude")
        if (lat is None) != (lng is None):
            raise serializers.ValidationError("Give both latitude and longitude, or neither.")
        if lat is not None and not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise serializers.ValidationError("Latitude must be -90..90 and longitude -180..180.")
        return attrs

    def _apply_location(self, validated_data):
        lat = validated_data.pop("latitude", None)
        lng = validated_data.pop("longitude", None)
        if lat is not None and lng is not None:
            point = Point(lng, lat, srid=4326)
            moved = self.instance is None or self.instance.location is None or self.instance.location != point
            validated_data["location"] = point
            # A new or moved pin is unverified until an admin explicitly says otherwise.
            if moved and "location_verified" not in validated_data:
                validated_data["location_verified"] = False

    def create(self, validated_data):
        self._apply_location(validated_data)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        self._apply_location(validated_data)
        return super().update(instance, validated_data)


class NearbyHospitalSerializer(HospitalSerializer):
    """Hospital + how far it is from the searched point."""

    distance_km = serializers.SerializerMethodField()
    doctor_count = serializers.IntegerField(read_only=True)

    class Meta(HospitalSerializer.Meta):
        fields = HospitalSerializer.Meta.fields + ["distance_km", "doctor_count"]

    def get_distance_km(self, obj):
        return round(obj.distance.km, 2) if getattr(obj, "distance", None) is not None else None


class NearbyQuerySerializer(serializers.Serializer):
    """Validates ?lat=&lng=&radius_km=&limit=&department= for the nearby search."""

    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    radius_km = serializers.FloatField(min_value=0.5, max_value=50, default=10)
    limit = serializers.IntegerField(min_value=1, max_value=50, default=20)
    department = serializers.IntegerField(required=False)
