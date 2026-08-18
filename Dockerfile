# PlaceMate - single combined container for AIC Cloud App Hosting.
#
# AIC Cloud auto-detects apps from the REPO ROOT only (no root-directory
# option), so this root-level Dockerfile bundles BOTH services into one image:
#   - Django REST API      -> port 8000 (gunicorn)
#   - Next.js frontend     -> port 3000 (next start)
# supervisord keeps both processes alive inside the same container.
#
# Build (from repo root):  docker build -t placemate:latest .
# Run:                     docker run -p 8000:8000 -p 3000:3000 placemate:latest
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT_BACKEND=8000 \
    PORT_FRONTEND=3000

# Node 22 LTS + npm for the Next.js build (Django stays pure-python).
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- Backend: deps first (cached until requirements.txt changes) ----
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install -r /app/backend/requirements.txt

# ---- Frontend: deps first (cached until package.json changes) ----
COPY frontend/package.json /app/frontend/package.json
RUN cd /app/frontend && npm install

# ---- Full application code ----
COPY backend /app/backend
COPY frontend /app/frontend

# Build the Next.js production bundle.
RUN cd /app/frontend && npm run build

# ---- Process manager ----
RUN pip install --no-cache-dir supervisor
COPY supervisord.conf /etc/supervisor/conf.d/placemate.conf
RUN chmod +x /app/backend/start.sh

EXPOSE 8000 3000

CMD ["supervisord", "-n", "-c", "/etc/supervisor/conf.d/placemate.conf"]
