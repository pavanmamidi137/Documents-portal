from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0007_resume_ai_analysis_resume_ai_analyzed_at_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="passout_year",
            field=models.PositiveSmallIntegerField(
                blank=True,
                help_text="Batch pass-out year (e.g. 2025) - shown next to every student.",
                null=True,
            ),
        ),
    ]
