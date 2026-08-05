from django.db import models


class Branch(models.Model):
    name = models.CharField(max_length=120, unique=True)
    code = models.CharField(max_length=20, unique=True, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class Section(models.Model):
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="sections")
    name = models.CharField(max_length=50)  # e.g. "A", "B"
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("branch", "name")
        ordering = ["branch__name", "name"]

    def __str__(self) -> str:
        return f"{self.branch.name} - Sec {self.name}"


class Semester(models.Model):
    name = models.CharField(max_length=20, unique=True)  # e.g. "3-1"
    order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "name"]

    def __str__(self) -> str:
        return self.name


class Category(models.Model):
    name = models.CharField(max_length=60, unique=True)  # e.g. "Mid-1", "Notes"
    icon = models.CharField(max_length=40, blank=True, default="")  # lucide icon name (UI)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "Categories"

    def __str__(self) -> str:
        return self.name


class Subject(models.Model):
    name = models.CharField(max_length=160)
    code = models.CharField(max_length=30, blank=True, default="")
    semester = models.ForeignKey(Semester, on_delete=models.CASCADE, related_name="subjects")
    # Nullable branch => subject is valid for the whole college at that semester.
    branch = models.ForeignKey(
        Branch, on_delete=models.CASCADE, related_name="subjects", null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("name", "semester", "branch")
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.semester.name})"
