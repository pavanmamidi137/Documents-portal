# PlaceMate backend - Django REST API.
# Built by AIC Cloud App Hosting (aiccloud.in) from this Dockerfile, or via
# framework auto-detect (root directory: backend). The container entrypoint
# (start.sh) runs migrate + seed + collectstatic once, then serves Gunicorn.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

WORKDIR /app

# Install dependencies first - this layer is cached until requirements.txt changes.
COPY requirements.txt .
RUN pip install -r requirements.txt

# Application code.
COPY . .

RUN chmod +x /app/start.sh

EXPOSE 8000

CMD ["/app/start.sh"]
