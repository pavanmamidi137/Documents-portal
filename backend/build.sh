#!/usr/bin/env bash
# Render build script for the Django backend.
set -e

pip install -r requirements.txt
python manage.py migrate --noinput
python manage.py seed_data
python manage.py collectstatic --noinput
