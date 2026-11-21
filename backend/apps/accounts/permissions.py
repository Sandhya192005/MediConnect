"""
Who may do what.

Two kinds of administrator (Step 4, owner decision 2026-11-16; roles split 2026-11-19):
- platform admin = a Django superuser (role "admin"): approves hospitals, answers appointment requests for
  non-partner hospitals, sees everything;
- hospital account = a user with role "hospital" linked to ONE hospital (staff.HospitalAdmin, table
  hospital_profile). It logs in with the hospital's email, manages that hospital's staff and sees its
  patients and appointments only. (Code names such as `admin_hospital` and `IsHospitalAdmin` predate the
  split and mean this hospital account.)
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission


class HasRole(BasePermission):
    """Use as `permission_classes = [role_required("doctor")]`."""

    allowed_roles: tuple = ()

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role in self.allowed_roles)


def role_required(*roles):
    return type("RoleRequired", (HasRole,), {"allowed_roles": roles})


IsPatient = role_required("patient")
IsDoctor = role_required("doctor")
IsAdminRole = role_required("admin")
IsHospitalRole = role_required("hospital")


def is_platform_admin(user) -> bool:
    return bool(user and user.is_authenticated and user.is_superuser)


def admin_hospital(user):
    """The hospital a hospital account manages, or None (also None for every other account)."""
    if not (user and user.is_authenticated and user.role == "hospital"):
        return None
    from apps.staff.models import HospitalAdmin

    link = HospitalAdmin.objects.select_related("hospital").filter(user=user).first()
    return link.hospital if link else None


class IsPlatformAdmin(BasePermission):
    message = "Only a platform administrator can do this."

    def has_permission(self, request, view):
        return is_platform_admin(request.user)


class IsHospitalAdmin(BasePermission):
    """A hospital admin. Views read the hospital from `request.admin_hospital`."""

    message = "Only a hospital administrator can do this."

    def has_permission(self, request, view):
        request.admin_hospital = admin_hospital(request.user)
        return request.admin_hospital is not None


class ReadOnlyOrAdmin(BasePermission):
    """Anyone can read; only a platform admin can create, edit or delete (e.g. hospitals, departments)."""

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return is_platform_admin(request.user)
