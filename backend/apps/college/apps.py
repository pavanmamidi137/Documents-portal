from django.apps import AppConfig


class CollegeConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.college'

    def ready(self):
        from . import signals  # noqa: F401
