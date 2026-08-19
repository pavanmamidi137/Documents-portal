#!/usr/bin/env bash
# Render build script for the Django backend.
set -e

# Install LaTeX for resume compilation (workspace feature).
# On Render Python runtimes, apt-get may not be available — the compile
# function gracefully falls back when pdflatex is missing.
if command -v apt-get &>/dev/null; then
  apt-get update -qq && apt-get install -y --no-install-recommends \
    texlive-latex-base texlive-fonts-recommended texlive-latex-extra > /dev/null 2>&1 || \
    echo "[build.sh] pdflatex install skipped (apt failed)"
fi

pip install -r requirements.txt
python manage.py migrate --noinput
python manage.py seed_data
python manage.py collectstatic --noinput
