from rest_framework import serializers

from apps.college.models import Branch, Category, Section, Semester, Subject

from .models import Document


class DocumentListSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    section_name = serializers.CharField(source="section.name", read_only=True)
    semester_name = serializers.CharField(source="semester.name", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    uploaded_by_name = serializers.CharField(source="uploaded_by.full_name", read_only=True, default=None)

    class Meta:
        model = Document
        fields = [
            "id", "title", "description", "file_name", "file_size",
            "cloudinary_url", "download_url", "downloads", "created_at",
            "branch", "branch_name", "section", "section_name",
            "semester", "semester_name", "category", "category_name",
            "subject", "subject_name", "uploaded_by", "uploaded_by_name",
        ]
        read_only_fields = fields


class DocumentSerializer(DocumentListSerializer):
    """Detail serializer (same fields; kept separate for clarity)."""


class DocumentCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    file = serializers.FileField(write_only=True)
    branch = serializers.PrimaryKeyRelatedField(queryset=Branch.objects.all())
    section = serializers.PrimaryKeyRelatedField(queryset=Section.objects.all())
    semester = serializers.PrimaryKeyRelatedField(queryset=Semester.objects.all())
    category = serializers.PrimaryKeyRelatedField(queryset=Category.objects.all())
    subject = serializers.PrimaryKeyRelatedField(queryset=Subject.objects.all())

    def validate(self, attrs):
        user = self.context["request"].user
        if user.is_cr:
            # CRs can only upload for their own assigned section.
            if attrs["branch"].id != user.branch_id or attrs["section"].id != user.section_id:
                raise serializers.ValidationError(
                    "CRs can only upload documents for their assigned section."
                )
        # Subject must belong to the selected semester and branch.
        subject = attrs["subject"]
        if subject.semester_id != attrs["semester"].id:
            raise serializers.ValidationError(
                {"subject": "Subject does not belong to the selected semester."}
            )
        if subject.branch_id and subject.branch_id != attrs["branch"].id:
            raise serializers.ValidationError(
                {"subject": "Subject does not belong to the selected branch."}
            )
        return attrs
