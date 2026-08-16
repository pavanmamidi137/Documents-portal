from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsSuperAdmin
from apps.core.utils import log_audit, notify

from .models import Feedback, Notification
from .serializers import FeedbackSerializer


class FeedbackViewSet(viewsets.ModelViewSet):
    """Students submit feedback & feature ideas; admins review, implement or decline them.

    Ideas the admin marks IMPLEMENTED are exposed publicly (with the submitter's
    name) through the ``implemented`` action, powering the home page's
    "Built from your ideas" section.
    """

    serializer_class = FeedbackSerializer
    search_fields = ["title", "message", "user__full_name", "user__roll_number"]
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]

    def get_permissions(self):
        if self.action == "implemented":
            return [AllowAny()]
        if self.action in ("list", "retrieve", "create"):
            return [IsAuthenticated()]
        return [IsSuperAdmin()]

    def get_queryset(self):
        qs = Feedback.objects.select_related("user")
        user = self.request.user
        if not (user and user.is_authenticated):
            return qs.none()
        if not user.is_super_admin:
            # Everyone else only sees their own submissions.
            return qs.filter(user=user)
        status = self.request.query_params.get("status")
        kind = self.request.query_params.get("kind")
        if status:
            qs = qs.filter(status=str(status).upper())
        if kind:
            qs = qs.filter(kind=str(kind).upper())
        return qs

    def create(self, request, *args, **kwargs):
        kind = str(request.data.get("kind", "IDEA")).upper()
        if kind not in Feedback.Kind.values:
            kind = Feedback.Kind.IDEA
        title = str(request.data.get("title", "")).strip()
        message = str(request.data.get("message", "")).strip()
        if not message:
            raise ValidationError({"message": "Please write your feedback or idea."})
        feedback = Feedback.objects.create(
            user=request.user,
            kind=kind,
            title=title[:150],
            message=message[:4000],
        )
        # Notify every admin so the submission is seen right away.
        from apps.accounts.models import User

        admins = User.objects.filter(role=User.Role.SUPER_ADMIN, is_active=True)
        notify(
            admins,
            Notification.Kind.FEEDBACK,
            f"New {('idea' if kind == Feedback.Kind.IDEA else 'feedback')} from {request.user.full_name}",
            f"{request.user.full_name} ({request.user.roll_number}): {message[:140]}",
            "/admin/feedback",
        )
        log_audit(
            request.user, "FEEDBACK", "Feedback", feedback.id,
            {"kind": kind, "title": title}, request,
        )
        return Response(FeedbackSerializer(feedback).data, status=201)

    def update(self, request, *args, **kwargs):
        feedback = self.get_object()
        new_status = str(request.data.get("status", "")).upper()
        if new_status not in Feedback.Status.values:
            raise ValidationError({"status": "Invalid status."})
        old_status = feedback.status
        feedback.status = new_status
        feedback.save(update_fields=["status", "updated_at"])
        # Close the loop when an idea goes live: the submitter hears about it.
        if new_status == Feedback.Status.IMPLEMENTED and old_status != new_status:
            notify(
                [feedback.user],
                Notification.Kind.FEEDBACK,
                "Your idea was implemented 🎉",
                f"\"{feedback.title or 'Your idea'}\" is now live on PlaceMate. Thank you!",
                "/feedback",
            )
        log_audit(
            request.user, "FEEDBACK_STATUS", "Feedback", feedback.id,
            {"from": old_status, "to": new_status}, request,
        )
        return Response(FeedbackSerializer(feedback).data)

    def destroy(self, request, *args, **kwargs):
        feedback = self.get_object()
        log_audit(
            request.user, "FEEDBACK_DELETE", "Feedback", feedback.id,
            {"kind": feedback.kind, "title": feedback.title}, request,
        )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=["get"], permission_classes=[AllowAny])
    def implemented(self, request):
        """Public: ideas that went live, with the submitter's name as credit."""
        rows = Feedback.objects.filter(status=Feedback.Status.IMPLEMENTED).select_related(
            "user"
        )[:12]
        return Response(
            [
                {
                    "id": f.id,
                    "title": f.title or f.message[:80],
                    "message": f.message,
                    "kind": f.kind,
                    "user_name": f.user.full_name if f.user else "",
                    "created_at": f.created_at,
                }
                for f in rows
            ]
        )
