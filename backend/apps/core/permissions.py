from rest_framework import permissions


class IsSuperAdmin(permissions.BasePermission):
    """Allow access only to Super Admins."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_super_admin)


class IsCR(permissions.BasePermission):
    """Allow access only to CRs (sub admins)."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_cr)


class IsSuperAdminOrCR(permissions.BasePermission):
    """Allow access to Super Admins and CRs."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and (user.is_super_admin or user.is_cr))


class IsStudent(permissions.BasePermission):
    """Allow access only to Students."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_student)


class IsSuperAdminForWrite(permissions.BasePermission):
    """Authenticated users may read; only Super Admins may write."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return user.is_super_admin
