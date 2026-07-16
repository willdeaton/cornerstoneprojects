# Cornerstone Project Tracker

A project pipeline, active-jobs, notes, and time-tracking dashboard for
**Cornerstone Facility Solutions** (DLOM Group).

Built with Next.js 15 (App Router) + TypeScript, Tailwind CSS, SQLite
(`better-sqlite3`), SheetJS for Excel import, and Recharts for the dashboard.

## Features

- **Dashboard** — pipeline vs. sold/in-progress, pipeline by customer, and a
  sold-by-status breakdown, with headline KPIs.
- **Open Quotes** — the prospective pipeline. Add quotes manually or **upload a
  weekly Excel/CSV file** (auto-detects Customer / Project / Category / Bid
  Value columns, with a preview before import). Mark a quote **Sold** to turn it
  into a project in one click.
- **Active Projects** — sold work with status (Not Started / In Progress /
  Completed), progress, value, hours logged, and due dates.
- **Project detail** — editable status & progress, **job notes**, and a
  per-job **time clock**.
- **Time Clock** — crew clock in/out of jobs, a live timer, weekly hours, "my
  recent time," and a live "on the clock now" panel.
- **Users & Auth** — email/password login, sign out, and user management
  (add users, set roles, reset passwords, deactivate). Roles: **admin**,
  **manager**, **worker**.
- **Settings** — upload a company logo to replace the default across the
  sign-in screen and sidebar (admins & managers).

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000. The SQLite database is created and **seeded on
first run** at `data/tracker.db` (the `data/` folder is git-ignored).

### Default logins (change these!)

| Role   | Email                    | Password         |
| ------ | ------------------------ | ---------------- |
| Admin  | wdeaton@dlomgroup.com    | `cornerstone2026`|
| Worker | mike@dlomgroup.com       | `welcome123`     |
| Worker | dave@dlomgroup.com       | `welcome123`     |

Sign in as the admin, go to **Users**, and reset these passwords right away.

## Production

```bash
npm run build
npm start
```

Runs as a normal Node server, so it can be deployed on any Node host (Railway,
Render, Fly.io, a VPS, etc.).

### Docker / Railway

A `Dockerfile` is included and is the recommended way to deploy. It installs a
full build toolchain (python3/make/g++) so the native `better-sqlite3` module
compiles reliably — the usual reason a plain buildpack (Nixpacks) build fails.

Railway auto-detects the `Dockerfile` and uses it. The app listens on `$PORT`
automatically.

**Important — persist the database:** the SQLite file lives at `/app/data`.
Container filesystems are wiped on every deploy, so add a **persistent volume**
mounted at `/app/data` (Railway → service → *Variables/Settings → Volumes →
mount path `/app/data`*). Without it, quotes/projects/time entries reset on each
deploy. Serverless platforms (e.g. Vercel) can't keep a SQLite file at all — use
a hosted database there instead.

```bash
# build & run locally with Docker
docker build -t cornerstone .
docker run -p 3000:3000 -v cornerstone-data:/app/data cornerstone
```

To start fresh, stop the app and delete `data/tracker.db*` (or the volume).

## Excel upload format

Any `.xlsx`/`.csv` with a header row works — columns are matched by name
(Customer, Project/Description, Category, Bid Value/Amount). Grab a starter
file from the **Download the template** link in the upload dialog.

## Brand

Colors and logo from the Cornerstone Brand Guidelines — primary green
`#98C73A`, secondary gray `#777777`.
