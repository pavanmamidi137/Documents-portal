from rest_framework import serializers

from .models import Announcement


class AnnouncementSerializer(serializers.ModelSerializer):
    visibility_label = serializers.CharField(source="visibility_label", read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default=None)

    class Meta:
        model = Announcement
        fields = [
            "id", "title", "body", "visibility", "visibility_label",
            "branch", "section", "created_by", "created_by_name",
            "created_at", "updated_at",
        ]
        read_only_fields = ["created_by", "created_at", "updated_at"]

    def validate(self, attrs):
        visibility = attrs.get("visibility", getattr(self.instance, "visibility", None))
        branch = attrs.get("branch", getattr(self.instance, "branch", None))
        section = attrs.get("section", getattr(self.instance, "section", None))

        if visibility == Announcement.Visibility.BRANCH and not branch:
            raise serializers.ValidationError(
                {"branch": "A branch is required for branch-level announcements."}
            )
        if visibility == Announcement.Visibility.SECTION and not section:
            raise serializers.ValidationError(
                {"section": "A section is required for section-level announcements."}
            )
        if visibility not in (Announcement.Visibility.BRANCH, Announcement.Visibility.SECTION):
            attrs["branch"] = None
            attrs["section"] = None
        return attrs
