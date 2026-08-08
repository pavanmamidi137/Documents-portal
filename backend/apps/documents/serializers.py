from rest_framework import serializers

from apps.college.models import Branch, Category, Section, Semester, Subject

from .models import Document, DocumentShareRequest


class DocumentListSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    section_name = serializers.CharField(source="section.name", read_only=True)
    semester_name = serializers.CharField(source="semester.name", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    uploaded_by_name = serializers.CharField(source="uploaded_by.full_name", read_only=True, default=None)
    # Signed delivery URL - plain raw Cloudinary URLs return HTTP 401 for
    # accounts with restricted delivery (signed URLs / ACL).
    cloudinary_url = serializers.SerializerMethodField()

    def get_cloudinary_url(self, obj) -> str:
        from .services import signed_raw_url

        return signed_raw_url(obj.public_id)

    class Meta:
        model = Document
        fields = [
            "id", "title", "description", "file_name", "file_size",
            "cloudinary_url", "download_url", "downloads", "created_at",
            "branch", "branch_name", "section", "section_name",
            "semester", "semester_name", "category", "category_name",
            "subject", "subject_name", "uploaded_by", "uploaded_by_name",
            "forked_from", "is_missing", "restored_at",
        ]
        read_only_fields = fields


class DocumentSerializer(DocumentListSerializer):
    """Detail serializer (same fields; kept separate for clarity)."""


class DocumentShareRequestSerializer(serializers.ModelSerializer):
    document_title = serializers.CharField(source="document.title", read_only=True)
    file_name = serializers.CharField(source="document.file_name", read_only=True)
    subject_name = serializers.CharField(source="document.subject.name", read_only=True)
    category_name = serializers.CharField(source="document.category.name", read_only=True)
    semester_name = serializers.CharField(source="document.semester.name", read_only=True)
    from_branch_name = serializers.CharField(source="from_section.branch.name", read_only=True)
    from_section_name = serializers.CharField(source="from_section.name", read_only=True)
    to_section_name = serializers.CharField(source="to_section.name", read_only=True)
    requested_by_name = serializers.CharField(
        source="requested_by.full_name", read_only=True, default=None
    )
    requested_by_roll = serializers.CharField(
        source="requested_by.roll_number", read_only=True, default=None
    )
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = DocumentShareRequest
        fields = [
            "id", "document", "document_title", "file_name",
            "subject_name", "category_name", "semester_name",
            "from_section", "from_section_name", "from_branch_name",
            "to_section", "to_section_name",
            "requested_by", "requested_by_name", "requested_by_roll",
            "status", "status_label", "note", "created_at", "responded_at",
        ]
        read_only_fields = fields


class DocumentCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    file = serializers.FileField(write_only=True)
    branch = serializers.PrimaryKeyRelatedField(queryset=Branch.objects.all())
    # Either a single primary `section` or a list `sections` (admin shares one
    # upload to many sections). CRs always end up with their own section.
    section = serializers.PrimaryKeyRelatedField(
        queryset=Section.objects.all(), required=False
    )
    sections = serializers.PrimaryKeyRelatedField(
        queryset=Section.objects.all(), many=True, required=False, write_only=True
    )
    semester = serializers.PrimaryKeyRelatedField(queryset=Semester.objects.all())
    category = serializers.PrimaryKeyRelatedField(queryset=Category.objects.all())
    subject = serializers.PrimaryKeyRelatedField(queryset=Subject.objects.all())

    def validate(self, attrs):
        user = self.context["request"].user
        sections = attrs.get("sections") or []
        if attrs.get("section"):
            sections.append(attrs["section"])
        sections = list({s.id: s for s in sections}.values())  # de-dupe by id
        if not sections:
            raise serializers.ValidationError(
                {"section": "At least one section is required."}
            )

        if user.is_cr:
            # CRs upload only to their own assigned section - no sharing.
            if attrs["branch"].id != user.branch_id:
                raise serializers.ValidationError(
                    "CRs can only upload documents for their assigned branch."
                )
            if any(s.id != user.section_id for s in sections):
                raise serializers.ValidationError(
                    "CRs can only upload documents for their assigned section."
                )
            sections = [user.section]

        # All target sections must belong to the selected branch.
        wrong = [s.name for s in sections if s.branch_id != attrs["branch"].id]
        if wrong:
            raise serializers.ValidationError(
                {"sections": f"Section(s) {', '.join(wrong)} do not belong to the selected branch."}
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
        attrs["sections"] = sections
        return attrs
