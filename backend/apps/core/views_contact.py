from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsSuperAdmin
from apps.core.utils import log_audit, notify

from .models import ContactRequest
from .serializers import ContactRequestSerializer


class ContactRequestViewSet(viewsets.ModelViewSet):
    """Let faculty/CRs approach the admin; admins manage and resolve them."""

    http_method_names = ["get", "post", "head", "options"]
    serializer_class = ContactRequestSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        user = self.request.user
        qs = ContactRequest.objects.select_related("sender")
        if not user.is_super_admin:
            # Everyone else only sees their own messages to the admin.
            qs = qs.filter(sender=user)
        return qs

    def create(self, request, *args, **kwargs):
        user = request.user
        if not (user.is_faculty or user.is_cr):
            raise PermissionDenied("Only faculty and CRs can contact the admin.")
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        contact = serializer.save(sender=user)
        # Notify every admin so the message is seen right away.
        from apps.accounts.models import User

        from .models import Notification

        admins = User.objects.filter(role=User.Role.SUPER_ADMIN, is_active=True)
        notify(
            admins,
            Notification.Kind.CONTACT_ADMIN,
            f"Contact request: {contact.subject}",
            f"{user.full_name} ({user.role_label}): {contact.message[:140]}",
            "/contact-admin",
        )
        log_audit(user, "CONTACT_ADMIN", "ContactRequest", contact.id,
                  {"subject": contact.subject}, request)
        return Response(ContactRequestSerializer(contact).data, status=201)

    @action(detail=True, methods=["post"], permission_classes=[IsSuperAdmin])
    def resolve(self, request, pk=None):
        contact = self.get_object()
        if contact.status == ContactRequest.Status.RESOLVED:
            raise ValidationError({"detail": "This request is already resolved."})
        contact.status = ContactRequest.Status.RESOLVED
        contact.resolved_at = timezone.now()
        contact.save(update_fields=["status", "resolved_at"])
        # Close the loop: the sender hears that the admin handled their request.
        from .models import Notification

        notify(
            [contact.sender],
            Notification.Kind.CONTACT_ADMIN,
            "Your request was resolved",
            f"\"{contact.subject}\" was marked as resolved by the admin.",
            "/contact-admin",
        )
        log_audit(request.user, "RESOLVE", "ContactRequest", contact.id,
                  {"subject": contact.subject}, request)
        return Response(ContactRequestSerializer(contact).data)
