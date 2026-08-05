from rest_framework import serializers

from .models import Branch, Category, Section, Semester, Subject


class BranchSerializer(serializers.ModelSerializer):
    sections_count = serializers.IntegerField(source="sections.count", read_only=True)
    students_count = serializers.IntegerField(source="students.count", read_only=True)

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
    students_count = serializers.IntegerField(source="students.count", read_only=True)

    class Meta:
        model = Section
        fields = ["id", "branch", "branch_name", "name", "students_count", "created_at"]
        read_only_fields = ["created_at"]

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Section name is required.")
        return value


class SemesterSerializer(serializers.ModelSerializer):
    subjects_count = serializers.IntegerField(source="subjects.count", read_only=True)
    documents_count = serializers.IntegerField(source="documents.count", read_only=True)

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
    documents_count = serializers.IntegerField(source="documents.count", read_only=True)

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
    documents_count = serializers.IntegerField(source="documents.count", read_only=True)

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
