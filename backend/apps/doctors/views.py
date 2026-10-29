from datetime import date

from django.db import transaction
from django.db.models import Q
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsDoctor

from .models import DoctorProfile
from .serializers import AvailabilitySerializer, DoctorSerializer
from .services import cached_slots, invalidate_slots

BASE_QS = DoctorProfile.objects.select_related("user", "hospital", "department").prefetch_related("availability")


class DoctorListView(generics.ListAPIView):
    """Public list of doctors that patients can book. Filters: q, department, hospital, city."""

    serializer_class = DoctorSerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        qs = BASE_QS.filter(is_active=True, hospital__isnull=False, hospital__is_approved=True)
        p = self.request.query_params
        if q := p.get("q"):
            qs = qs.filter(
                Q(user__first_name__icontains=q) | Q(user__last_name__icontains=q)
                | Q(specialization__icontains=q) | Q(hospital__name__icontains=q)
            )
        if dept := p.get("department"):
            qs = qs.filter(department_id=dept)
        if hospital := p.get("hospital"):
            qs = qs.filter(hospital_id=hospital)
        if city := p.get("city"):
            qs = qs.filter(hospital__city__iexact=city)
        return qs


class DoctorDetailView(generics.RetrieveAPIView):
    queryset = BASE_QS
    serializer_class = DoctorSerializer
    permission_classes = [permissions.AllowAny]


class DoctorSlotsView(APIView):
    """GET /api/doctors/<id>/slots/?date=YYYY-MM-DD"""

    permission_classes = [permissions.AllowAny]

    def get(self, request, pk):
        doctor = generics.get_object_or_404(DoctorProfile, pk=pk)
        try:
            day = date.fromisoformat(request.query_params.get("date", ""))
        except ValueError:
            day = date.today()
        slots = cached_slots(doctor, day) if doctor.is_bookable else []
        return Response({"date": day, "slots": slots})


class MyDoctorProfileView(generics.RetrieveUpdateAPIView):
    """The logged-in doctor's own profile."""

    serializer_class = DoctorSerializer
    permission_classes = [IsDoctor]

    def get_object(self):
        profile, _ = DoctorProfile.objects.get_or_create(user=self.request.user)
        return profile

    def perform_update(self, serializer):
        profile = serializer.save()
        invalidate_slots(profile.id)  # slot length or hospital may have changed


class MyAvailabilityView(APIView):
    """GET returns weekly hours; PUT replaces them all with the list sent."""

    permission_classes = [IsDoctor]

    def get(self, request):
        profile, _ = DoctorProfile.objects.get_or_create(user=request.user)
        return Response(AvailabilitySerializer(profile.availability.all(), many=True).data)

    def put(self, request):
        profile, _ = DoctorProfile.objects.get_or_create(user=request.user)
        serializer = AvailabilitySerializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            profile.availability.all().delete()
            serializer.save(doctor=profile)
        invalidate_slots(profile.id)
        return Response(serializer.data, status=status.HTTP_200_OK)
