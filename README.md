# PlaceMate — Campus Portal

# 🤝 PlaceMate — Campus Documents, Resumes & Placements

A production-ready portal for colleges to manage study documents, student resumes (with AI reviews) and placement drives — **Django REST API** + **Next.js 15/16 frontend**, backed by **Supabase PostgreSQL**, **Cloudinary** (file storage) and **NVIDIA Nemotron AI**. Installable as a **PWA** on Android, Windows and supported browsers.

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui · TanStack Query · React Hook Form · Zod · Framer Motion · Recharts |
| Backend | Django 5 · Django REST Framework · SimpleJWT · Django ORM |
| Database | Supabase PostgreSQL (pgbouncer pooler) |
| Storage | Cloudinary (PDFs only — **no files on Render**) |
| Deployment | Render (Web Service ×2) + Supabase + Cloudinary |

## ✨ Features

- **Auth** — Login with roll number + password, JWT access + refresh tokens, automatic token refresh on the frontend, protected routes, role-based access.
- **4 roles**
  - **Super Admin** — dashboard analytics & charts, branch/section/semester/category/subject management, student CRUD + CSV bulk import/export (with **Gender** & **Passout Year**), activate/deactivate, reset password, **promote/demote CR**, document upload/delete anywhere, announcements with visibility targeting, audit logs, global search, **faculty portal access control** (resume / placement / both) and **per-student AI limits**.
  - **CR (Sub Admin)** — can only see/manage **their own section**: students (add/edit/delete/reset password), document & assignment upload (locked to own branch/section), share requests with other sections, student-style document browsing.
  - **Faculty** — review student resumes in their branch (mark reviewed, bulk review, ZIP download), see **every student's upload status**, and/or post placement drives — gated by the admin-assigned portal access.
  - **Student** — semester cards → categories → subjects → document list with assignment deadlines, preview/download, search, announcements, **resume upload with AI star rating + ATS report**, placement drives with eligibility and apply links, change password.
- **Documents & assignments** — files uploaded to Cloudinary as raw files under `documents/{branch}/{section}/{semester}/{category}/{subject}/`; only the URL + public ID are stored in PostgreSQL. Assignments can carry a **submission deadline** badge.
- **Resumes** — one resume per student, delivered to branch faculty with **review status** (delivered / pending / reviewed / missing / restored). Uploads are **auto-analyzed** by AI for a **0–5 star rating**, daily AI request & upload limits (admin-adjustable per roll number) and a **10-day ATS report** view gate.
- **Placements** — company drives with optional last date, eligibility, roll-number lists (paste or Excel), apply links and a **RAG-grounded AI assistant**; drive detail pages with an inline chatbot; students see their match % and eligibility.
- **Notifications** — bell with unread count; document/drive/resume/announcement notifications; drive notifications clear only when the drive is actually opened.
- **CSV** — bulk-import students (`Roll Number, Student Name, Phone, Email, Gender, Passout Year`), export students & documents reports.
- **Audit log** — every login, create/update/delete, promote/demote, upload, download, CSV action is recorded (actor, action, target, IP, details).
- **PWA** — installable on Android/Windows/iOS with manifest, icons and a service worker (authenticated API responses are never cached).
- **UI** — professional responsive dashboard, dark/light mode, 8 portal color themes, animated cards, charts, paginated data tables, filters, toasts, skeletons, empty states, confirmation dialogs.

## 📁 Project structure

```
├── backend/                  # Django REST API
│   ├── config/               # settings, urls, wsgi
│   ├── apps/
│   │   ├── accounts/         # User (roll number login, roles), JWT auth, student mgmt, CSV
│   │   ├── college/          # Branch, Section, Semester, Category, Subject
│   │   ├── documents/        # Document model + Cloudinary service
│   │   ├── announcements/    # Announcements with visibility
│   │   └── core/             # AuditLog, permissions, pagination, dashboard, search
│   ├── requirements.txt
│   ├── Procfile · build.sh · .env.example
│   └── .env                  # ← real credentials (gitignored)
└── frontend/                 # Next.js app
    ├── src/app/              # routes: login, dashboard, admin/*, cr/*, documents, announcements, profile, search
    ├── src/components/       # layout, data-table, dialogs, role pages
    ├── src/lib/              # axios client (auto-refresh), auth context, types, utils
    └── .env.local            # ← NEXT_PUBLIC_API_URL (gitignored)
```

## 🚀 Local setup

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate   |  macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then paste your real values (see below)
python manage.py migrate        # creates the schema in Supabase PostgreSQL
python manage.py seed_data      # super admin + 8 semesters + 9 categories + sample subjects
python manage.py runserver      # http://localhost:8000
```

> **Database note:** `DATABASE_URL` is the Supabase **transaction-mode pooler** (runtime requests), `DIRECT_URL` is the **session-mode pooler** (used automatically for `migrate`). If `DATABASE_URL` is empty the app falls back to local SQLite for development/tests.

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local     # set NEXT_PUBLIC_API_URL=http://localhost:8000/api
npm run dev                    # http://localhost:3000
```

Default super admin after `seed_data`: **roll number `admin` / password `Admin@123`** (override via `ADMIN_ROLL_NUMBER` / `ADMIN_PASSWORD`).

## 🔐 Environment variables

**Backend (`backend/.env`)** — see `.env.example`:

| Variable | Description |
|---|---|
| `DJANGO_SECRET_KEY` | Long random string (Render can auto-generate) |
| `DJANGO_DEBUG` | `True` locally, `False` in production |
| `DATABASE_URL` | Supabase transaction-mode pooler URL |
| `DIRECT_URL` | Supabase session-mode pooler URL (migrations) |
| `CORS_ALLOWED_ORIGINS` | Comma-separated frontend origins |
| `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` | Cloudinary credentials |
| `MAX_PDF_SIZE_MB` | Upload limit (default 20) |
| `NVIDIA_API_KEY` | NVIDIA Nemotron API key (placement AI + resume analysis) |
| `NVIDIA_RAG_API_KEY` | Optional — separate NVIDIA RAG key (falls back to the 30B model otherwise) |
| `NVIDIA_RAG_MODEL` | RAG model id (default `nvidia/nim-rag`) |
| `AI_DAILY_REQUEST_LIMIT` | Default daily AI requests per student (default 5) |
| `ATS_VIEW_INTERVAL_DAYS` | ATS report refresh interval (default 10) |
| `RESUME_DAILY_UPLOAD_LIMIT` | Resume uploads per day per student (default 2) |
| `AI_AUTO_ANALYZE_ON_UPLOAD` | Auto-analyze resumes after upload (default 1) |
| `AI_ENCRYPTION_KEY` | **Required in production** - encrypts AI provider API keys at rest (AES-GCM). Must be stable across deploys; Render's `DJANGO_SECRET_KEY` changes per deploy and is never used. |
| `PBKDF2_ITERATIONS` | Password-hash cost. Default `216000` ≈ 3x faster logins than Django's 720k default; `720000` for maximum hash security |
| `THROTTLE_LOGIN_RATE` | Login attempts per IP per minute (default `10/min`; `60/min` avoids 429s when a campus shares one public IP via mobile NAT) |
| `ADMIN_ROLL_NUMBER/ADMIN_PASSWORD/...` | Seed-data super admin |

**AI health report** (`python manage.py daily_ai_report`): summarizes the last 24h of AI provider usage (calls, errors, uptime %, fallbacks, token usage and an estimated cost at `ai_cost_per_million_tokens` - a site setting, default $0.50 per 1M tokens) and notifies every Super Admin in-app. Schedule it once a day, e.g. via Render's Cron Jobs running `manage.py daily_ai_report`, or add an admin cron: `0 8 * * * cd /path/to/backend && .venv/bin/python manage.py daily_ai_report`. The same report is shown live on the Admin → AI Management → Usage tab, which also has a **Send report now** button.

**Frontend (`frontend/.env.local`)**:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | e.g. `http://localhost:8000/api` or `https://api.onrender.com/api` |

## 📡 API overview (all under `/api/`)

- **Auth** — `POST /auth/login/`, `POST /auth/refresh/`, `POST /auth/logout/` (blacklists the refresh token), `GET /auth/me/`, `POST /auth/change-password/`
- **Reference** — `GET/POST/PATCH/DELETE /branches/`, `/sections/`, `/semesters/`, `/categories/`, `/subjects/` (reads for all authenticated users, writes for Super Admin), `GET /meta/`
- **Students** — `GET/POST/PATCH/DELETE /students/`, `POST /students/import_csv/`, `GET /students/export_csv/`, `POST /students/{id}/promote|demote|activate|deactivate|reset_password/`
- **Documents** — `GET/POST/DELETE /documents/` (multipart upload), `POST /documents/{id}/download/`, `GET /documents/export_csv/`
- **Announcements** — `GET/POST/PATCH/DELETE /announcements/`
- **Documents** — `GET/POST /documents/` (upload once, `sections: [ids]` shares one file to many sections), `POST /documents/{id}/share/` (admin, share to more sections), `POST /documents/{id}/fork/` (CR/admin, copy a document into a section without re-uploading), `GET /documents/forkable/` (documents from other sections available to fork), `POST /documents/{id}/download/`, `GET /documents/export_csv/`
- **Other** — `GET /dashboard/` (role-aware), `GET /search/?q=`, `GET /audit-logs/` (+ `POST /audit-logs/clear/` for selected ids or `{all: true}`), `GET/PUT /site-theme/` (public read / admin set, 7 color themes), `GET /health/`

All endpoints (except login/refresh/health) require `Authorization: Bearer <access_token>`.

## ☁️ Deployment guide (Render + Supabase + Cloudinary)

1. **Supabase** — Create a project. In **Settings → Database**, grab the pooler connection strings (transaction mode for `DATABASE_URL`, session mode for `DIRECT_URL`) and the database password.
2. **Cloudinary** — Create an account; copy cloud name, API key and API secret.
3. **Render** — Push this repo to GitHub, then **New + → Blueprint**, select `render.yaml` (includes both services), and fill in the `sync: false` env vars:
   - `DATABASE_URL`, `DIRECT_URL` (Supabase pooler URLs)
   - `CORS_ALLOWED_ORIGINS` → `https://<your-web-service>.onrender.com`
   - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
   - `ADMIN_PASSWORD` → your super admin password
   - `NEXT_PUBLIC_API_URL` → `https://<your-api-service>.onrender.com/api`
4. The backend build script (`build.sh`) runs `migrate`, `seed_data` and `collectstatic` automatically. `DJANGO_SECRET_KEY` is auto-generated.

> **Scaling:** the API uses the pgbouncer transaction pooler + `DISABLE_SERVER_SIDE_CURSORS` for safe high-concurrency operation; Cloudinary keeps PDF storage off the web servers entirely.

## 📈 Scaling & Load Balancing (more users, no lag)

The portal is already built to handle hundreds of simultaneous users (cached heavy endpoints, pgbouncer connection pooling, files on Cloudinary, stateless JWT auth). To keep it fast as the campus grows:

### 1. Never let the server sleep (kills the "slow login" complaint)

On Render's **Free** tier the web service **spins down after ~15 min of inactivity**, so the first login after a lull waits for a cold boot (10–60 s). Upgrade the **backend** and **frontend** services to a paid plan (**Starter $7/mo or higher**) — instances stay **always-on** and the very first request is fast.

### 2. Right-size the Gunicorn workers (free speed, no code)

- Starter (0.25 vCPU): `--workers 2 --threads 4` (the default in `Procfile`/`render.yaml`) ≈ 8 concurrent requests.
- Standard (0.5+ vCPU): raise to `--workers 4 --threads 4`.
- Each worker is its own process, so CPU-heavy work (password hashing, JWT) scales with the worker count.

### 3. Horizontal scaling — Render's built-in load balancer

When you need more headroom than one instance, **scale the backend to 2–3 instances**:

1. Render dashboard → **documents-portal-api** → **Settings** → **Instance count** → `2` (or `3`) → **Save**. When an instance serves traffic directly to the internet, Render places it behind its **built-in load balancer** and spreads requests round-robin across all instances — no extra load-balancer service or config needed.
2. The frontend stays a single instance (it proxies to the API by URL) — scale it too only if the Next.js build is the bottleneck.
3. Auth is **stateless JWT** (no sticky sessions), uploads go straight to Cloudinary, and list/dashboard endpoints cache in-memory per instance — so multi-instance is fully safe.

> **Notes:** each extra instance multiplies memory cost, so keep instances on **Standard** (512 MB+) and prefer 2 Standard over 4 Starter. The in-memory cache is per-instance (fine — every instance serves its own users fast). If you later want shared cache + shared throttling across instances, add a **Redis** instance (`REDIS_URL`) and switch `CACHES` to it; not required until you're past ~1,000 concurrent users.

### 4. Load-test before a big event (campus drive, exam week)

```bash
# quick spike test against the API (adjust -c for concurrency)
curl -s -o /dev/null -w "%{time_total}\n" https://<api>.onrender.com/api/health/
```

If login feels slow under load, the two levers are **PBKDF2_ITERATIONS** (hash cost, see env table) and **instance size/CPU** — raising the CPU speeds up every login because password hashing is CPU-bound.

## ✅ Tests

```bash
cd backend
DATABASE_URL= DIRECT_URL= python manage.py test apps.accounts apps.documents
```

## ⚠️ Troubleshooting

- **`password authentication failed for user "postgres"`** — the Supabase database password in `backend/.env` is wrong. Reset it in Supabase → Settings → Database → *Reset database password* and update `DATABASE_URL`/`DIRECT_URL` (and the env vars on Render). The project ref in the pooler username (`postgres.<project-ref>`) must match your project.
- **401 on uploads** — tokens expire after 30 min; the frontend auto-refreshes. A full page reload restores the session from the refresh token.
- **Cloudinary upload fails** — verify the three `CLOUDINARY_*` values and that your Cloudinary plan allows raw/PDF uploads.
