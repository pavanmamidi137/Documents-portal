from types import SimpleNamespace

from django.test import TestCase

from apps.accounts.models import User
from apps.core.permissions import IsSuperAdmin, IsSuperAdminOrCR, IsStudent
from apps.core.utils import csv_safe


class CsvSafeTests(TestCase):
    def test_neutralizes_formula_cells(self):
        self.assertEqual(csv_safe("=cmd()"), "'=cmd()")
        self.assertEqual(csv_safe("+SUM(A1)"), "'+SUM(A1)")
        self.assertEqual(csv_safe("-100"), "'-100")
        self.assertEqual(csv_safe("@import"), "'@import")

    def test_leaves_normal_values_alone(self):
        self.assertEqual(csv_safe("Aarav"), "Aarav")
        self.assertEqual(csv_safe("21CSE01"), "21CSE01")
        self.assertEqual(csv_safe(""), "")


class PermissionTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(roll_number="admin", password="x", full_name="Admin")
        self.cr = User.objects.create_user(
            roll_number="cr1", password="x", full_name="CR", role=User.Role.CR
        )
        self.student = User.objects.create_user(
            roll_number="st1", password="x", full_name="Student"
        )

    def _user_permission(self, cls, user):
        return cls().has_permission(SimpleNamespace(user=user), None)

    def test_role_permissions(self):
        self.assertTrue(self._user_permission(IsSuperAdmin, self.admin))
        self.assertFalse(self._user_permission(IsSuperAdmin, self.cr))
        self.assertFalse(self._user_permission(IsSuperAdmin, self.student))
        self.assertTrue(self._user_permission(IsSuperAdminOrCR, self.admin))
        self.assertTrue(self._user_permission(IsSuperAdminOrCR, self.cr))
        self.assertFalse(self._user_permission(IsSuperAdminOrCR, self.student))
        self.assertTrue(self._user_permission(IsStudent, self.student))
        self.assertFalse(self._user_permission(IsStudent, self.cr))
