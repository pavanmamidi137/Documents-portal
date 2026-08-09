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
        qs = Notification.objects.filter(user=self.request.user).order_by("-created_at")
        scope = self.request.query_params.get("scope", "").lower()
        if scope == "unread":
            qs = qs.filter(read=False)
        # The bell dropdown only shows the newest notifications, but the full
        # history page (?scope=all) gets everything.
        if scope == "all":
            return qs
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

    @action(detail=False, methods=["post"], url_path="mark_kind_read")
    def mark_kind_read(self, request):
        """Mark every unread notification of one kind as read.

        Used by the placements detail page: a drive notification's count only
        clears once the student actually opens the drive, not when the bell is
        clicked. Pass ``kind`` (e.g. DRIVE) as JSON or a query param.
        """
        kind = (request.data.get("kind") or request.query_params.get("kind") or "").upper()
        if kind not in Notification.Kind.values:
            return Response({"ok": False, "detail": "Unknown notification kind."}, status=400)
        count = Notification.objects.filter(
            user=request.user, kind=kind, read=False
        ).update(read=True)
        return Response({"ok": True, "updated": count})
