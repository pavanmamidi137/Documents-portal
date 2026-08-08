from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Notification
from .serializers import NotificationSerializer


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    """The calling user's own in-app notifications (bell in the top bar)."""

    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None  # the bell needs a simple flat list

    def get_queryset(self):
        qs = Notification.objects.filter(user=self.request.user)
        scope = self.request.query_params.get("scope", "").lower()
        if scope == "unread":
            qs = qs.filter(read=False)
        # The bell only shows the newest notifications - never ship the whole
        # history to the dropdown.
        return qs[:50]

    @action(detail=False, methods=["get"])
    def unread_count(self, request):
        count = Notification.objects.filter(user=request.user, read=False).count()
        return Response({"count": count})

    @action(detail=True, methods=["post"])
    def mark_read(self, request, pk=None):
        # Update without a full serializer round-trip; harmless if already read.
        Notification.objects.filter(pk=pk, user=request.user).update(read=True)
        return Response({"ok": True})

    @action(detail=False, methods=["post"])
    def read_all(self, request):
        Notification.objects.filter(user=request.user, read=False).update(read=True)
        return Response({"ok": True})
