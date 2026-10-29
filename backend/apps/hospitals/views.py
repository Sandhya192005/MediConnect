from rest_framework import viewsets

from apps.accounts.permissions import ReadOnlyOrAdmin

from .models import Department, Hospital
from .serializers import DepartmentSerializer, HospitalSerializer


class DepartmentViewSet(viewsets.ModelViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    permission_classes = [ReadOnlyOrAdmin]
    pagination_class = None


class HospitalViewSet(viewsets.ModelViewSet):
    serializer_class = HospitalSerializer
    permission_classes = [ReadOnlyOrAdmin]

    def get_queryset(self):
        qs = Hospital.objects.prefetch_related("departments")
        # Admins also see hospitals that are waiting for approval.
        user = self.request.user
        if not (user.is_authenticated and user.role == "admin"):
            qs = qs.filter(is_approved=True)
        if city := self.request.query_params.get("city"):
            qs = qs.filter(city__iexact=city)
        if dept := self.request.query_params.get("department"):
            qs = qs.filter(departments__id=dept)
        return qs.distinct()
