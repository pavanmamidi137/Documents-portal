#!/usr/bin/env bash
# Koyeb container entrypoint for the PlaceMate backend.
# Runs migrations + seed + static collection on every cold start, then serves.
set -e

echo "[start.sh] Running migrations..."
python manage.py migrate --noinput

echo "[start.sh] Seeding data..."
python manage.py seed_data

echo "[start.sh] Collecting static files..."
python manage.py collectstatic --noinput

echo "[start.sh] Starting Gunicorn..."
exec gunicorn config.wsgi:application \
  --bind 0.0.0.0:${PORT:-8000} \
  --workers ${GUNICORN_WORKERS:-2} \
  --threads ${GUNICORN_THREADS:-4} \
  --timeout ${GUNICORN_TIMEOUT:-120} \
  --access-logfile -
