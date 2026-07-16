# Cornerstone Project Tracker

A project pipeline, active-jobs, notes, and time-tracking dashboard for
**Cornerstone Facility Solutions** (DLOM Group).

Built with Next.js 15 (App Router) + TypeScript, Tailwind CSS, PostgreSQL
(`pg`), SheetJS for Excel import, and Recharts for the dashboard.

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

You need a PostgreSQL database. Point the app at it with `DATABASE_URL`:

```bash
npm install
export DATABASE_URL="postgresql://user:password@localhost:5432/cornerstone"
npm run dev
```

Open http://localhost:3000. The tables are created and **seeded on first run**.
If `DATABASE_URL` is unset, the app falls back to
`postgresql://postgres:postgres@localhost:5432/cornerstone` for local dev.
Connections to non-local hosts use SSL automatically (set `PGSSL=false` to
disable, or `PGSSL=true` to force it).

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

A `Dockerfile` is included and is the recommended way to deploy. Since the app
talks to PostgreSQL through the pure-JS `pg` driver, no native build toolchain
is needed. Railway auto-detects the `Dockerfile` and uses it; the app listens on
`$PORT` automatically.

**Set `DATABASE_URL`** to your Postgres connection string (Railway → add a
PostgreSQL plugin, then reference its `DATABASE_URL` on the app service). The
schema is created and seeded automatically on first connection, and the data
lives in Postgres, so it survives redeploys with no volume to manage. Serverless
platforms (e.g. Vercel) work too, as long as `DATABASE_URL` points at a hosted
Postgres.

```bash
# build & run locally with Docker (pointing at a Postgres you provide)
docker build -t cornerstone .
docker run -p 3000:3000 -e DATABASE_URL="postgresql://user:pass@host:5432/cornerstone" cornerstone
```

To start fresh, drop and recreate the database (or `TRUNCATE` its tables).

## Excel upload format

Any `.xlsx`/`.csv` with a header row works — columns are matched by name
(Customer, Project/Description, Category, Bid Value/Amount). Grab a starter
file from the **Download the template** link in the upload dialog.

## Brand

Colors and logo from the Cornerstone Brand Guidelines — primary green
`#98C73A`, secondary gray `#777777`.
