from rest_framework import serializers

from .models import Branch, Category, Section, Semester, Subject


class BranchSerializer(serializers.ModelSerializer):
    # Counts are annotated on the queryset (``sections_count`` / ``students_count``)
    # so listing branches runs a single query instead of one COUNT per row.
    sections_count = serializers.IntegerField(read_only=True, default=0)
    students_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Branch
        fields = ["id", "name", "code", "sections_count", "students_count", "created_at"]
        read_only_fields = ["created_at"]

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Branch name is required.")
        return value


class SectionSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    branch_code = serializers.CharField(source="branch.code", read_only=True, default="")
    students_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Section
        fields = [
            "id", "branch", "branch_name", "branch_code",
            "name", "students_count", "created_at",
        ]
        read_only_fields = ["created_at"]

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Section name is required.")
        return value


class SemesterSerializer(serializers.ModelSerializer):
    subjects_count = serializers.IntegerField(read_only=True, default=0)
    documents_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Semester
        fields = ["id", "name", "order", "subjects_count", "documents_count", "created_at"]
        read_only_fields = ["created_at"]

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Semester name is required.")
        return value


class CategorySerializer(serializers.ModelSerializer):
    documents_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Category
        fields = ["id", "name", "icon", "documents_count", "created_at"]
        read_only_fields = ["created_at"]

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Category name is required.")
        return value


class SubjectSerializer(serializers.ModelSerializer):
    semester_name = serializers.CharField(source="semester.name", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    documents_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Subject
        fields = [
            "id", "name", "code", "semester", "semester_name",
            "branch", "branch_name", "documents_count", "created_at",
        ]
        read_only_fields = ["created_at"]

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Subject name is required.")
        return value
