# Documents-portal

# 🎓 College Document Management Portal

A production-ready portal for colleges to manage study documents — **Django REST API** + **Next.js 15/16 frontend**, backed by **Supabase PostgreSQL** and **Cloudinary** (PDF storage).

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui · TanStack Query · React Hook Form · Zod · Framer Motion · Recharts |
| Backend | Django 5 · Django REST Framework · SimpleJWT · Django ORM |
| Database | Supabase PostgreSQL (pgbouncer pooler) |
| Storage | Cloudinary (PDFs only — **no files on Render**) |
| Deployment | Render (Web Service ×2) + Supabase + Cloudinary |

## ✨ Features

- **Auth** — Login with roll number + password, JWT access + refresh tokens, automatic token refresh on the frontend, protected routes, role-based access.
- **3 roles**
  - **Super Admin** — dashboard analytics & charts, branch/section/semester/category/subject management, student CRUD + CSV bulk import/export, activate/deactivate, reset password, **promote/demote CR**, document upload/delete anywhere, announcements with visibility targeting, audit logs, global search.
  - **CR (Sub Admin)** — can only see/manage **their own section**: students (add/edit/delete/reset password), document upload (locked to own branch/section), cannot promote, cannot touch other sections.
  - **Student** — semester cards → categories → subjects → PDF list, preview/download PDFs, search, announcements, change password, **cannot upload**.
- **Documents** — PDFs uploaded to Cloudinary as raw files under `documents/{branch}/{section}/{semester}/{category}/{subject}/`; only the URL + public ID are stored in PostgreSQL. Deleting a document also deletes the Cloudinary file.
- **CSV** — bulk-import students (`Roll Number, Student Name, Email, Phone, Branch, Section, Password`), export students & documents reports.
- **Audit log** — every login, create/update/delete, promote/demote, upload, download, CSV action is recorded (actor, action, target, IP, details).
- **UI** — professional responsive dashboard, dark/light mode, animated cards, charts, paginated data tables, filters, toasts, skeletons, empty states, confirmation dialogs.

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
| `ADMIN_ROLL_NUMBER/ADMIN_PASSWORD/...` | Seed-data super admin |

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
- **Other** — `GET /dashboard/` (role-aware), `GET /search/?q=`, `GET /audit-logs/`, `GET /health/`

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

## ✅ Tests

```bash
cd backend
DATABASE_URL= DIRECT_URL= python manage.py test apps.accounts apps.documents
```

## ⚠️ Troubleshooting

- **`password authentication failed for user "postgres"`** — the Supabase database password in `backend/.env` is wrong. Reset it in Supabase → Settings → Database → *Reset database password* and update `DATABASE_URL`/`DIRECT_URL` (and the env vars on Render). The project ref in the pooler username (`postgres.<project-ref>`) must match your project.
- **401 on uploads** — tokens expire after 30 min; the frontend auto-refreshes. A full page reload restores the session from the refresh token.
- **Cloudinary upload fails** — verify the three `CLOUDINARY_*` values and that your Cloudinary plan allows raw/PDF uploads.
