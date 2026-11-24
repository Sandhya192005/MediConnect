"""
Hospital profile (owner request 2026-11-20): a hospital account edits its own hospital's details.

GET/PATCH /api/hospital-admin/profile/

- Name, address, city, state, phone, website and departments apply at once, also when the hospital is
  connected: patients see the new details straight away. A name or city change notifies the platform admins.
- The map pin: owner decision 2026-11-20, "the hospital needs a pin, the platform admin isn't involved":
  a pin the hospital sets itself counts as confirmed (location_verified=True), so patients' "Get directions"
  uses it. No notification for pin moves.
- The hospital email is the login, so it's read-only here (changing it goes through Support).
- Departments (owner request 2026-11-24): tick existing ones (department_ids) and/or type new names
  (new_departments). A typed name that matches an existing department, ignoring case and spaces, reuses it;
  otherwise it's created (created_by = this hospital) and joins the shared list (patients can filter by it).
  DELETE profile/departments/<id>/ (the × on every department the hospital has or wrote): removes it from
  this hospital; a department the hospital wrote also leaves the shared list when no other hospital, doctor
  account or staff record uses it (others, e.g. the platform's Cardiology, always stay in the list). Staff
  records in it keep their department: a department still in use is never deleted.
"""

import re


from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.db import transaction
from django.db.models import Q
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsHospitalAdmin
from apps.hospitals.models import Department, Hospital

User = get_user_model()


def _clean(value: str) -> str:
    return " ".join(str(value).split())


DEPT_NAME = re.compile(r"[A-Za-z0-9 &()./,'-]+")


def department_named(name: str, hospital: Hospital) -> Department:
    """The department with this name, ignoring case; created (by this hospital) when there's none yet."""
    found = Department.objects.filter(name__iexact=name).first()
    if found:
        return found
    # unique name: safe if two hospitals race
    dept, _ = Department.objects.get_or_create(name=name, defaults={"created_by": hospital})
    return dept


class HospitalProfileSerializer(serializers.ModelSerializer):
    latitude = serializers.FloatField(required=False, allow_null=True, min_value=-90, max_value=90)
    longitude = serializers.FloatField(required=False, allow_null=True, min_value=-180, max_value=180)
    department_ids = serializers.PrimaryKeyRelatedField(
        source="departments", queryset=Department.objects.all(), many=True, required=False)
    new_departments = serializers.ListField(
        child=serializers.CharField(max_length=100), required=False, write_only=True, max_length=20)
    departments = serializers.SerializerMethodField()
    written_department_ids = serializers.SerializerMethodField()  # ticked or not: these get the × (2026-11-24)
    connected = serializers.BooleanField(source="is_approved", read_only=True)

    class Meta:
        model = Hospital
        fields = ["id", "name", "email", "address", "city", "state", "phone", "website",
                  "latitude", "longitude", "location_verified", "departments", "department_ids", "new_departments",
                  "written_department_ids", "connected"]
        read_only_fields = ["id", "email", "location_verified"]

    def get_departments(self, h):
        return [{"id": d.id, "name": d.name, "mine": d.created_by_id == h.id} for d in h.departments.order_by("name")]

    def get_written_department_ids(self, h):
        return list(h.created_departments.order_by("id").values_list("id", flat=True))

    def to_representation(self, h):
        data = super().to_representation(h)
        data["latitude"] = h.location.y if h.location else None
        data["longitude"] = h.location.x if h.location else None
        return data

    def validate_name(self, v):
        v = _clean(v)
        if len(v) < 2:
            raise serializers.ValidationError("Enter the hospital's name.")
        return v

    def validate_city(self, v):
        v = _clean(v)
        if not v:
            raise serializers.ValidationError("Enter the city.")
        return v

    def validate_address(self, v):
        return _clean(v)

    def validate_state(self, v):
        return _clean(v)

    def validate_new_departments(self, names):
        out = []
        for raw in names:
            name = _clean(raw)
            if len(name) < 2 or not DEPT_NAME.fullmatch(name) or not any(c.isalpha() for c in name):
                raise serializers.ValidationError(f'"{name or raw}" is not a department name: use letters, spaces and & - ( ) . / , only.')
            if name.lower() not in {n.lower() for n in out}:
                out.append(name)
        return out

    def validate_phone(self, v):
        v = _clean(v)
        if v and not all(c.isdigit() or c in "+-() " for c in v):
            raise serializers.ValidationError("Use digits, spaces and + - ( ) only.")
        return v

    def validate(self, attrs):
        has_lat, has_lng = "latitude" in attrs, "longitude" in attrs
        if has_lat != has_lng or (has_lat and (attrs["latitude"] is None) != (attrs["longitude"] is None)):
            raise serializers.ValidationError({"latitude": "Send both latitude and longitude, or neither."})
        # A connected hospital must stay findable: it can move its address, not remove it.
        h = self.instance
        if h is not None and h.is_approved:
            if "address" in attrs and len(attrs["address"]) < 5:
                raise serializers.ValidationError({"address": "Patients use the address to find you: it can't be empty."})
            if "phone" in attrs and not attrs["phone"]:
                raise serializers.ValidationError({"phone": "Patients need a phone number to call: it can't be empty."})
        return attrs

    def update(self, h, validated):
        departments = validated.pop("departments", None)
        new_names = validated.pop("new_departments", [])
        if "latitude" in validated:
            lat, lng = validated.pop("latitude"), validated.pop("longitude")
            if lat is None:
                h.location, h.location_verified = None, False
            else:
                # The hospital's own pin counts as confirmed (owner decision 2026-11-20).
                h.location, h.location_verified = Point(lng, lat, srid=4326), True
        if "website" in validated and validated["website"] != h.website:
            h.website_source = ""  # set by the hospital itself
        for field, value in validated.items():
            setattr(h, field, value)
        h.save()
        if departments is not None:
            h.departments.set(departments)
        if new_names:
            h.departments.add(*[department_named(n, h) for n in new_names])
        return h


class HospitalProfileView(APIView):
    permission_classes = [IsHospitalAdmin]

    def get(self, request):
        return Response(HospitalProfileSerializer(request.admin_hospital).data)

    def patch(self, request):
        h = request.admin_hospital
        old_name, old_city = h.name, h.city
        s = HospitalProfileSerializer(h, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        with transaction.atomic():
            h = s.save()
            if h.name != old_name:
                # The hospital is the account: its account name follows the hospital's name (greeting, menus).
                User.objects.filter(hospital_admin__hospital=h, role="hospital").update(first_name=h.name[:150])
            changes = []
            if h.name != old_name:
                changes.append(f'name "{old_name}" → "{h.name}"')
            if h.city != old_city:
                changes.append(f'city "{old_city}" → "{h.city}"')
            if changes:
                from apps.hospitals.connections import _notify

                _notify(User.objects.filter(is_superuser=True, is_active=True), "hospital_updated",
                        "Hospital details changed", f"{h.name} changed its " + " and ".join(changes) + ".",
                        "/admin/hospitals")  # Connected hospitals
        return Response(HospitalProfileSerializer(h).data)


class HospitalDepartmentDeleteView(APIView):
    """DELETE /api/hospital-admin/profile/departments/<id>/: the × on a department (see the module notes)."""

    permission_classes = [IsHospitalAdmin]

    def delete(self, request, pk):
        from apps.staff.models import StaffMember

        h = request.admin_hospital
        dept = Department.objects.filter(Q(created_by=h) | Q(hospitals=h), pk=pk).distinct().first()
        if dept is None:
            return Response({"detail": "This department isn't on your hospital."}, status=404)
        with transaction.atomic():
            h.departments.remove(dept)
            used_elsewhere = (dept.hospitals.exists() or dept.doctors.exists()
                              or StaffMember.objects.filter(department=dept).exists())
            if dept.created_by_id != h.id or used_elsewhere:
                deleted = False  # stays in the shared list, just not at this hospital
            else:
                dept.delete()
                deleted = True
        data = HospitalProfileSerializer(h).data
        return Response({"deleted": deleted, "departments": data["departments"],
                         "written_department_ids": data["written_department_ids"]})
