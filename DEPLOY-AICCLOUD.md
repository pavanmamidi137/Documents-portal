# Deploy PlaceMate on AIC Cloud (aiccloud.in)

This guide deploys PlaceMate on **AIC Cloud App Hosting** — two separate apps
connected to this GitHub repo, exactly like the old Render setup:

| App | What it runs | Root directory | Runtime |
|---|---|---|---|
| `placemate-api` | Django REST API | `backend/` | Python 3.13 (Dockerfile or auto-detect) |
| `placemate-web` | Next.js 16 frontend | `frontend/` | Node 22 (Dockerfile or auto-detect) |

The **Supabase database and Cloudinary stay exactly as they are** — nothing
moves. Only the app processes relocate. Both apps can be deployed via the
dashboard (recommended) or the AIC Cloud API.

---

## 0. Prerequisites

- AIC Cloud account → **App Hosting** is available (₹99/mo, free tier to start).
- This repo pushed to GitHub (the Dockerfiles + `.nvmrc` in this repo are ready).
- Your **Render env values** open in another tab — you'll copy most of them over.
  Open Render → your `documents-portal-api` service → **Environment**.
- Two values must be **copied exactly** from Render, or things break:

  - `AI_ENCRYPTION_KEY` — decrypts the AI provider API keys stored in the DB
    (admin → AI Management). A different value = unreadable keys = AI features fail.
  - `DJANGO_SECRET_KEY` — a different value signs JWTs differently = **everyone
    gets logged out** and refresh tokens stop working.

---

## 1. Backend app (`placemate-api`)

### Dashboard steps

1. [aiccloud.in/dashboard](https://aiccloud.in/dashboard) → **App Hosting** → **Create App**
2. **Connect GitHub** (read access to `pavanmamidi137/Documents-portal`)
3. **Repository:** `pavanmamidi137/Documents-portal` · **Branch:** `main`
4. **Root directory:** `backend`
5. **Framework:** pick **Dockerfile** (uses `backend/Dockerfile` — most reliable),
   or choose **Django** if the dashboard offers auto-detect for a subdirectory.
6. **Port:** `8000`
7. **Health check (recommended):** `GET /api/health/` on port 8000

### Environment variables (add every one)

Copy values from Render unless noted:

| Variable | Value |
|---|---|
| `DJANGO_SECRET_KEY` | **Copy from Render exactly** (keeps JWTs valid) |
| `DJANGO_DEBUG` | `False` |
| `DJANGO_ALLOWED_HOSTS` | your backend URL, e.g. `placemate-api.aiccloud.one` |
| `DATABASE_URL` | **Copy from Render** (Supabase pooler) |
| `DIRECT_URL` | **Copy from Render** (Supabase direct) |
| `CORS_ALLOWED_ORIGINS` | your frontend URL, e.g. `https://placemate-web.aiccloud.one` (add localhost too for dev) |
| `TRUST_X_FORWARDED_FOR` | `1` — correct audit-log IPs behind AIC's proxy |
| `AI_ENCRYPTION_KEY` | **Copy from Render exactly** |
| `CLOUDINARY_CLOUD_NAME` | copy from Render |
| `CLOUDINARY_API_KEY` | copy from Render |
| `CLOUDINARY_API_SECRET` | copy from Render |
| `MAX_PDF_SIZE_MB` | `20` (or your Render value) |
| `MAX_DOCUMENT_SIZE_MB` | copy from Render |
| `DOCUMENT_MAX_INPUT_MB` | copy from Render |
| `DOCUMENT_COMPRESS_AFTER_MB` | copy from Render |
| `THROTTLE_LOGIN_RATE` | copy from Render |
| `THROTTLE_AI_RATE` | copy from Render |
| `THROTTLE_USER_RATE` | copy from Render |
| `THROTTLE_ANON_RATE` | copy from Render |
| `AI_DAILY_REQUEST_LIMIT` | copy from Render |
| `RESUME_DAILY_UPLOAD_LIMIT` | copy from Render |
| `AI_REVIEW_WINDOW_DAYS` | copy from Render |
| `ATS_VIEW_INTERVAL_DAYS` | copy from Render |
| `RESUME_UPLOAD_WINDOW_DAYS` | copy from Render |
| `AI_LOG_RETENTION_DAYS` | `30` |
| `JWT_ACCESS_MINUTES` | copy from Render |
| `JWT_REFRESH_DAYS` | copy from Render |
| `PBKDF2_ITERATIONS` | `216000` |
| `ADMIN_ROLL_NUMBER` | `admin` |
| `ADMIN_PASSWORD` | your super-admin password (used by `seed_data` on boot) |
| `ADMIN_NAME` | `Super Admin` (optional) |
| `ADMIN_EMAIL` | optional |
| `NVIDIA_BASE_URL` / `NVIDIA_MODEL` / `NVIDIA_RAG_MODEL` | optional — fallbacks only; real provider keys are managed in **Admin → AI Management** and stored encrypted |

Deploy. Every boot runs `migrate → seed_data → collectstatic → gunicorn`
(see `backend/start.sh`).

---

## 2. Frontend app (`placemate-web`)

1. **App Hosting → Create App** → same GitHub repo, branch `main`
2. **Root directory:** `frontend`
3. **Framework:** pick **Dockerfile** (`frontend/Dockerfile`), or **Next.js**
   auto-detect (build `npm install && npm run build`, start `npm run start`,
   output default). `.nvmrc` pins Node 22.
4. **Port:** `3000`

### Environment variables

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://placemate-api.aiccloud.one/api` (your backend URL + `/api`) |

> `NEXT_PUBLIC_API_URL` is baked into the JS **at build time** — update it and
> redeploy if the backend URL ever changes.

---

## 3. Domains & SSL

- AIC gives each app a free subdomain (dashboard shows it, e.g.
  `placemate-api.aiccloud.one` / `placemate-web.aiccloud.one`) with **free
  automatic SSL** — nothing to do for a first deploy.
- **Custom domain:** App settings → **Domains** → add your domain (e.g.
  `placemate.yourcollege.in`) → point an A/CNAME record at AIC (they show the
  target) → SSL issues automatically.
- After adding/changing domains, update on the backend:
  - `DJANGO_ALLOWED_HOSTS` ← backend domain
  - `CORS_ALLOWED_ORIGINS` ← frontend domain (comma-separated list)
  - then **redeploy the backend**.

---

## 4. After deploy — checklist

1. **Backend:** open `https://<api-url>/api/health/` → should return 200 JSON.
2. **Frontend:** open `https://<web-url>/` → home page loads.
3. **Login** with the admin account → dashboard loads (proves JWT + CORS).
4. **AI check:** Admin → AI Management → Providers → **Test connection**
   (proves `AI_ENCRYPTION_KEY` matches the stored provider keys).
5. **Document check:** open a document → preview + download a PDF
   (proves Cloudinary + signed URLs).
6. **Deep link:** open `https://<web-url>/placements/<any-id>` directly in a new
   tab → drive page renders (dynamic route works on the Node runtime).

---

## 5. Daily AI-log cleanup

The old Render cron ran `python manage.py cleanup_ai_logs` daily. AIC App
Hosting has no scheduled jobs UI yet, so pick one:

- **Manual:** Admin → AI Usage → **"Clear logs older than 30 days"** button.
- **Automatic (recommended):** point a free cron service
  (e.g. [cron-job.org](https://cron-job.org), `0 3 * * *`) at the backend's
  admin cleanup endpoint, or SSH into a VPS and run
  `python manage.py cleanup_ai_logs` with the backend env vars.

---

## 6. (Optional) Deploy via the AIC Cloud API

App Hosting endpoints exist under `https://api.aiccloud.in` (auth:
`Authorization: Bearer aic_...`):

```
GET    /api/v1/apps/            list apps
POST   /api/v1/apps/            create + deploy
GET    /api/v1/apps/:id         app details
POST   /api/v1/apps/:id/deploy  redeploy
PUT    /api/v1/apps/:id/env     update env vars
GET    /api/v1/apps/:id/logs    logs
```

The published OpenAPI spec (`/openapi.json`) doesn't include the app payload
schema yet, so the dashboard is the reliable path for now. Example:

```bash
curl -X GET "https://api.aiccloud.in/api/v1/apps" \
  -H "Authorization: Bearer aic_your_key_here"
```

---

## 7. Cutover from Render

1. Deploy backend on AIC → verify `/api/health/` + login.
2. Deploy frontend on AIC → verify full smoke test above.
3. Point your real domain at the AIC app (DNS), keep Render running in parallel
   until the smoke test passes on the custom domain.
4. Decommission the Render services.
