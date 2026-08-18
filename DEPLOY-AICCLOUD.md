# Deploy PlaceMate on AIC Cloud (aiccloud.in)

AIC Cloud App Hosting detects apps from the **repo root** (there is no
"root directory" option), so this repo ships a **root `Dockerfile`** that
bundles BOTH services into **one image**:

| Service | Port | What runs |
|---|---|---|
| Django REST API | `8000` | gunicorn via `backend/start.sh` (migrate → seed → collectstatic → serve) |
| Next.js frontend | `3000` | `next start` |

`supervisord` keeps both processes alive inside the single container, so you
create **one AIC app** and the whole portal works.

The **Supabase database and Cloudinary stay exactly as they are** — nothing
moves. Only the app process relocates from Render.

---

## 1. Create the app

1. [aiccloud.in/dashboard](https://aiccloud.in/dashboard) → **App Hosting** → **Create App**
2. **Connect GitHub** (read access to `pavanmamidi137/Documents-portal`)
3. **Repository:** `pavanmamidi137/Documents-portal` · **Branch:** `main`
4. Framework detection will see the root `Dockerfile` — choose **Dockerfile** if it asks.
   (If it auto-detects Node from the root `package.json` instead, that's fine too —
   the build steps below produce the same result. The `Dockerfile` path is the
   reliable one.)
5. **Port:** expose `8000` and `3000` (or set the main port to `8000` — see
   "Which port is the main one" below)
6. Deploy. Every boot runs `migrate → seed_data → collectstatic → gunicorn`
   (see `backend/start.sh`) and `next start` together.

### Which port is the main one?

- If the dashboard asks for a single **port to route the domain to**, use `8000`
  (the API). The frontend stays reachable on its own port if the platform
  exposes both, but for a single-domain setup you usually proxy the domain to
  **one** port.
- If AIC only exposes **one** public port per app, the browser still needs to
  reach the API by URL, so a single public port can't serve both. In that case
  use **Option A in section 5** — two apps from this same repo, one exposing
  port 8000 (API) and one exposing port 3000 (frontend). Start with port
  `8000` as the API app's port and verify login works; adjust based on what
  the dashboard lets you expose.

> ⚠️ **Deploy-time reality check:** if AIC's current dashboard only maps **one**
> public port per app, the simplest *guaranteed* setup is **two apps** from the
> same repo — both use this same root Dockerfile, and each just forwards a
> different port (one app with `PORT_FRONTEND` disabled, one with
> `PORT_BACKEND` disabled via env, or simply forward both). Details below.

---

## 2. Environment variables (add every one)

Copy values from Render unless noted:

| Variable | Value |
|---|---|
| `DJANGO_SECRET_KEY` | **Copy from Render exactly** (keeps JWTs valid) |
| `DJANGO_DEBUG` | `False` |
| `DJANGO_ALLOWED_HOSTS` | your backend URL, e.g. `placemate.aiccloud.one` |
| `DATABASE_URL` | **Copy from Render** (Supabase pooler) |
| `DIRECT_URL` | **Copy from Render** (Supabase direct) |
| `CORS_ALLOWED_ORIGINS` | your frontend URL, e.g. `https://placemate.aiccloud.one` (add `http://localhost:3000` for dev) |
| `TRUST_X_FORWARDED_FOR` | `1` — correct audit-log IPs behind AIC's proxy |
| `AI_ENCRYPTION_KEY` | **Copy from Render exactly** (decrypts AI provider keys) |
| `CLOUDINARY_CLOUD_NAME` | copy from Render |
| `CLOUDINARY_API_KEY` | copy from Render |
| `CLOUDINARY_API_SECRET` | copy from Render |
| `MAX_PDF_SIZE_MB` / `MAX_DOCUMENT_SIZE_MB` / `DOCUMENT_MAX_INPUT_MB` / `DOCUMENT_COMPRESS_AFTER_MB` | copy from Render |
| `THROTTLE_LOGIN_RATE` / `THROTTLE_AI_RATE` / `THROTTLE_USER_RATE` / `THROTTLE_ANON_RATE` | copy from Render |
| `AI_DAILY_REQUEST_LIMIT` / `RESUME_DAILY_UPLOAD_LIMIT` / `AI_REVIEW_WINDOW_DAYS` / `ATS_VIEW_INTERVAL_DAYS` / `RESUME_UPLOAD_WINDOW_DAYS` | copy from Render |
| `AI_LOG_RETENTION_DAYS` | `30` |
| `JWT_ACCESS_MINUTES` / `JWT_REFRESH_DAYS` | copy from Render |
| `PBKDF2_ITERATIONS` | `216000` |
| `ADMIN_ROLL_NUMBER` | `admin` |
| `ADMIN_PASSWORD` | your super-admin password (used by `seed_data` on boot) |
| `ADMIN_NAME` / `ADMIN_EMAIL` | optional |
| `PORT_BACKEND` / `PORT_FRONTEND` | `8000` / `3000` (defaults; change only if AIC assigns different ports) |
| `NEXT_PUBLIC_API_URL` | **required by the frontend build** — your public API URL, e.g. `https://placemate.aiccloud.one/api` (or the API app's URL if you split into two apps) |

> `NEXT_PUBLIC_API_URL` is baked into the frontend JS **at build time** — update
> it and redeploy if the API URL ever changes. If AIC exposes only one public
> port and you run frontend + API on the same origin, set it to
> `https://<your-domain>/api` and make sure the container routes `/api` to the
> backend (see section 5).

---

## 3. Domains & SSL

- AIC gives each app a free subdomain (dashboard shows it) with **free automatic
  SSL** — nothing to do for a first deploy.
- **Custom domain:** App settings → **Domains** → add your domain → point an
  A/CNAME record at AIC's target → SSL issues automatically.
- After changing domains, update on the backend: `DJANGO_ALLOWED_HOSTS` (backend
  domain) + `CORS_ALLOWED_ORIGINS` (frontend domain) → **redeploy**.

---

## 4. After deploy — checklist

1. **Backend:** open `https://<your-domain>/api/health/` → 200 JSON.
2. **Frontend:** open `https://<your-domain>/` → home page loads.
3. **Login** with the admin account → dashboard loads (proves JWT + CORS).
4. **AI check:** Admin → AI Management → Providers → **Test connection**
   (proves `AI_ENCRYPTION_KEY` matches the stored provider keys).
5. **Document check:** open a document → preview + download a PDF
   (proves Cloudinary + signed URLs).
6. **Deep link:** open `https://<your-domain>/placements/<any-id>` directly in a
   new tab → drive page renders.

---

## 5. If AIC exposes only ONE public port per app

Two options, in order of preference:

**Option A — two apps, same repo (recommended):**
1. App 1 (`placemate-api`): root `Dockerfile`, public port `8000`.
2. App 2 (`placemate-web`): root `Dockerfile`, public port `3000`.
   To keep each lean you can add env `PORT_BACKEND=0` / `PORT_FRONTEND=0`…
   — simpler: just let both run; the unused service is harmless. Set
   `NEXT_PUBLIC_API_URL=https://<api-app>.aiccloud.one/api` on App 2 and
   `CORS_ALLOWED_ORIGINS=https://<web-app>.aiccloud.one` on App 1.
   Supabase/Cloudinary/AI keys go on App 1; App 2 only needs
   `NEXT_PUBLIC_API_URL`.

**Option B — one app, same origin:** frontend and API on the same public URL.
Point the public port at `3000`, set `NEXT_PUBLIC_API_URL=/api`, and add a tiny
reverse proxy inside the container so `/api/*` goes to port 8000. (This needs a
small config addition — ask if you want it; Option A avoids the extra moving
part.)

---

## 6. Daily AI-log cleanup

The old Render cron ran `python manage.py cleanup_ai_logs` daily. AIC App
Hosting has no scheduled jobs UI yet, so pick one:

- **Manual:** Admin → AI Usage → **"Clear logs older than 30 days"** button.
- **Automatic (recommended):** point a free cron service
  (e.g. [cron-job.org](https://cron-job.org), `0 3 * * *`) at the backend's
  admin cleanup endpoint, or SSH into a VPS and run
  `python manage.py cleanup_ai_logs` with the backend env vars.

---

## 7. Cutover from Render

1. Deploy the AIC app(s) → verify `/api/health/` + login.
2. Verify the full smoke test above.
3. Point your real domain at the AIC app (DNS), keep Render running in parallel
   until the smoke test passes on the custom domain.
4. Decommission the Render services.

---

## Local build & test

```bash
# From the repo root:
docker build -t placemate:latest .
docker run --rm -p 8000:8000 -p 3000:3000 \
  -e DJANGO_SECRET_KEY=dev-key \
  -e DJANGO_ALLOWED_HOSTS=localhost \
  -e DJANGO_DEBUG=False \
  -e DATABASE_URL=sqlite:////tmp/placemate.db \
  -e DIRECT_URL=sqlite:////tmp/placemate.db \
  -e ADMIN_ROLL_NUMBER=admin -e ADMIN_PASSWORD=Admin@123 \
  -e THROTTLE_LOGIN_RATE=10000/min \
  -e NEXT_PUBLIC_API_URL=http://localhost:8000/api \
  placemate:latest
# then: curl http://localhost:8000/api/health/  and  open http://localhost:3000
```
