from rest_framework.permissions import BasePermission


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
