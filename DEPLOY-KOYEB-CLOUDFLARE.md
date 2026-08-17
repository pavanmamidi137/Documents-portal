# Deploy PlaceMate: Backend → Koyeb, Frontend → Cloudflare Pages

This moves the app off Render (backend + frontend) onto:

- **Backend (Django REST)** → [Koyeb](https://koyeb.com) — git-driven Docker build
- **Frontend (Next.js)** → [Cloudflare Pages](https://pages.cloudflare.com) — static export served from the edge

The database (Supabase Postgres) and Cloudinary storage stay exactly as they are — **no data migration needed**. The Supabase `DATABASE_URL` / `DIRECT_URL` values from Render are reused as-is.

---

## What was changed in the repo

| File | Purpose |
|---|---|
| `backend/Dockerfile` | Koyeb image: Python 3.13, installs `requirements.txt` |
| `backend/start.sh` | Container entrypoint: `migrate` → `seed_data` → `collectstatic` → `gunicorn` |
| `backend/.dockerignore` | Keeps `.env`, `.venv`, `db.sqlite3` etc. out of the image |
| `frontend/next.config.ts` | `output: "export"` when `EXPORT_STATIC=1` (Cloudflare build env). Opt-in, so the Render deploy keeps working unchanged until you cut over |
| `frontend/src/app/(app)/placements/page.tsx` | Drive detail moved to a query-param view: `/placements?drive=<id>` (static export has no dynamic routes) |
| `frontend/src/components/placements/drive-detail.tsx` | The old `/placements/[id]` page, now a reusable client component |
| `frontend/public/_redirects` | SPA fallback for unknown paths (`/* /index.html 200`) |
| `backend/apps/placements/views.py`, `signals.py`, `tests.py` | Drive notification deep links updated to `/placements?drive=<id>` |

---

## Part 1 — Backend on Koyeb

### 1. Create the app

1. Sign up at [koyeb.com](https://koyeb.com) (free tier available).
2. **Overview → Create App → GitHub** → connect your GitHub account and pick this repo.
3. Fill in the service:
   - **Name:** `placemate-api`
   - **Type:** Web
   - **Builder:** **Dockerfile** (not buildpack)
   - **Project/Root directory:** `backend`
   - **Dockerfile path:** `Dockerfile` (relative to the root directory)
   - **Port:** `8000` (HTTP)
4. Health check (optional but recommended): path `/api/health/`, port `8000`.

### 2. Environment variables

| Variable | Value / note |
|---|---|
| `DJANGO_SECRET_KEY` | **Copy the value from Render.** Reusing it keeps existing JWT sessions valid during cutover. |
| `DJANGO_DEBUG` | `False` |
| `DJANGO_ALLOWED_HOSTS` | `<your-app>-<org>.koyeb.app` (the URL Koyeb shows you). Comma-separated if you add a custom domain later. |
| `DATABASE_URL` | **Same Supabase transaction-mode pooler URL as Render** |
| `DIRECT_URL` | **Same Supabase session-mode pooler URL as Render** |
| `TRUST_X_FORWARDED_FOR` | `1` (Koyeb's proxy appends the real client IP; without this the audit log trusts forged headers) |
| `CORS_ALLOWED_ORIGINS` | `https://<your-app>.pages.dev,http://localhost:3000` (the Cloudflare frontend origin — from Part 2) |
| `CLOUDINARY_CLOUD_NAME` | Same as Render |
| `CLOUDINARY_API_KEY` | Same as Render |
| `CLOUDINARY_API_SECRET` | Same as Render |
| `NVIDIA_API_KEY` | Same as Render (env fallback for AI; providers are mostly DB-managed) |
| `NVIDIA_RAG_API_KEY` | Same as Render (optional) |
| `NVIDIA_RAG_MODEL` | `nvidia/nim-rag` (or whatever you use) |
| `AI_ENCRYPTION_KEY` | **MUST copy the exact value from Render** — it decrypts AI provider API keys stored in the DB. A different value makes stored keys unreadable. |
| `MAX_PDF_SIZE_MB` | `20` (same as Render) |
| `THROTTLE_LOGIN_RATE` | `60/min` (campus users share one public IP) |
| `PBKDF2_ITERATIONS` | `216000` |
| `ADMIN_ROLL_NUMBER` | `admin` |
| `ADMIN_PASSWORD` | Your super-admin password (used by `seed_data` on first boot) |

Optional: `JWT_ACCESS_MINUTES`, `JWT_REFRESH_DAYS`, `AI_LOG_RETENTION_DAYS`, `AI_DAILY_REQUEST_LIMIT`, `AI_REVIEW_WINDOW_DAYS`, `ATS_VIEW_INTERVAL_DAYS`.

### 3. Deploy

Hit **Deploy**. Koyeb builds the Docker image, then `start.sh` runs migrations, seeds the admin and collects static files before Gunicorn serves on `:8000`. Check the **build** and **runtime** logs tabs if anything fails.

**Instance size:** the free **nano** (0.1 vCPU / 256 MB) is too small for 2 Gunicorn workers × 4 threads. Use at least the cheapest 1 vCPU / 1 GB instance, or set `GUNICORN_WORKERS=1` + `GUNICORN_THREADS=2` in the env to fit a smaller instance. Also remember every PDF preview/download streams **through the backend** (auth + signed URLs), so pick a plan with enough egress bandwidth for your document traffic.

### 4. Daily AI-log cleanup (the Render cron)

1. In the same app: **Create Service → Type: Job**.
2. Same git source + Dockerfile as the web service.
3. **Schedule:** cron `0 3 * * *` (daily 03:00 UTC ≈ 08:30 IST).
4. **Command / Run:** `python manage.py cleanup_ai_logs`
5. Env: `DATABASE_URL`, `DIRECT_URL`, `AI_LOG_RETENTION_DAYS=30`, `DJANGO_SECRET_KEY` (any value is fine — cleanup never decrypts stored keys).

Skipping the cron is fine — admins can still prune from **Admin → AI Management → Usage → "Clear logs older than 30 days"**.

---

## Part 2 — Frontend on Cloudflare Pages

The frontend is 100% client-side (JWT in localStorage + axios against the Django API — no server components, no API routes), so it deploys as a **static export** — fastest possible delivery from Cloudflare's edge, on the free tier, and the PWA install keeps working (manifest + `sw.js` are generated at build).

### 1. Create the project

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
2. **Framework preset:** `Next.js (Static HTML Export)`.
3. Override the build settings:
   - **Build command:** `npm install && EXPORT_STATIC=1 npm run build`
   - **Build output directory:** `out`
   - **Environment variables:**
     - `NEXT_PUBLIC_API_URL` = `https://<your-app>-<org>.koyeb.app/api` (the Koyeb backend from Part 1)

   > `NEXT_PUBLIC_API_URL` is baked into the JS **at build time** — change it → redeploy.
4. **Deploy.** You get `<project>.pages.dev`.

### 2. How routing works on static hosting

- Every route (`/`, `/login`, `/dashboard`, `/documents`, `/placements`, …) is pre-rendered into `out/<route>/index.html` and served directly.
- The drive detail page is a **query-param view**: `/placements?drive=<id>`. All in-app links use it, and drive notifications now point there too.
- `public/_redirects` (`/* /index.html 200`) is a safety net: unknown paths (old `/placements/123` links, trailing slashes, future routes) render the app shell and the client router shows the right page instead of a 404.
- The PWA service worker (`sw.js`) and `manifest.webmanifest` are static files in `out/` — install-to-home-screen works exactly as on Render.

---

## Part 3 — Cutover

1. **Backend first.** Get the Koyeb API healthy (`/api/health/` → 200).
2. **Frontend second.** Deploy the Pages project with `NEXT_PUBLIC_API_URL` pointing at Koyeb.
3. **CORS.** Confirm `CORS_ALLOWED_ORIGINS` on Koyeb includes the `.pages.dev` URL (or the frontend's API calls will be blocked).
4. **Smoke test:** login → browse documents → download/preview a PDF → resume upload + AI review → drive chat.
5. **Super admin:** `seed_data` recreates the admin from `ADMIN_ROLL_NUMBER`/`ADMIN_PASSWORD` if it doesn't exist; your real users and data are untouched.
6. **AI providers:** if `AI_ENCRYPTION_KEY` was copied exactly, everything in Admin → AI Management works as-is. If you used a new key, re-enter the provider API keys once.
7. **Decommission Render** (or keep it a few days as a rollback): delete the `documents-portal-api`, the cron, and the `documents-portal-web` services. The DB and Cloudinary are shared, so nothing else to migrate.

---

## Gotchas

- **`AI_ENCRYPTION_KEY` must match Render's exactly**, or stored AI provider keys become undecryptable. Same for `DJANGO_SECRET_KEY` if you want zero logouts during cutover.
- **Koyeb free tier** is for tiny apps — the portal streams files through the backend, so a paid instance with real memory/bandwidth is recommended (see Part 1, instance size).
- **`TRUST_X_FORWARDED_FOR=1`** is required on Koyeb for correct audit-log IPs (Render set it automatically via `RENDER=true`; Koyeb does not).
- **NEXT_PUBLIC_API_URL is build-time** — every change needs a Cloudflare redeploy (automatic on push to `main`).
- Both platforms auto-deploy on every push to `main` — the repo is configured so `output: "export"` only activates on Cloudflare (`EXPORT_STATIC=1`), keeping the Render deploy working until you delete it.
