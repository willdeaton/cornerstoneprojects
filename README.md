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
  **manager**, **worker**. User management lives under **Settings → Users**.
- **View as role** (admins only) — a "View as" switcher in the sidebar lets an
  admin preview the app exactly as a **manager** or **worker** would see it
  (hidden nav, page redirects, and restricted actions all apply). An amber
  banner marks the preview; "Exit preview" or picking **Admin** returns to full
  access. Previewing only ever lowers access — it can never escalate.
- **Settings** (admins & managers) — a tabbed area with **Company** (name,
  address, phone, email, and website shown on customer-facing quote PDFs),
  **Email** (sender identity for automated notifications), and **Users**.

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

## Email notifications

Automated email (sender identity, per-user subscriptions, scheduled reminders /
reports, and event-driven schedule-change alerts) is built in.

- **Sender identity** lives in a single settings row, edited under **Settings →
  Email Settings** (`from_name` / `from_email`). The from address must be a
  sender authenticated with your email provider.
- **Transport** is the provider's HTTP API (SendGrid v3 `/mail/send`) — not
  SMTP. The API key is read from the **`SENDGRID_API_KEY`** environment variable
  and is never stored in the database. Nothing is sent unless both the key and a
  `from_email` are set.
- **Who receives what** is controlled per-user with subscription checkboxes in
  the user add/edit forms (Users page). Addresses resolve
  `personal_email → work_email → login email`.
- **Scheduled emails** are driven by env vars + a built-in cron scheduler
  (defaults shown; all off unless turned `on`):

  ```bash
  PROJECT_REMINDER=on   PROJECT_REMINDER_DAY=fri  PROJECT_REMINDER_HOUR=8  PROJECT_REMINDER_TZ=America/New_York
  COMPLETION_REPORT=on  COMPLETION_REPORT_DAY=mon COMPLETION_REPORT_HOUR=7 COMPLETION_REPORT_TZ=America/New_York
  ```

  Duplicate sends across multiple workers are debounced by a per-job singleton
  run lock. Each job can also be fired manually (bypassing the debounce) via
  `POST /api/email/send-reminders` and `POST /api/email/send-report`; send a
  test message with `POST /api/test-email`.

Email body/HTML content is intentionally left as stubbed placeholder functions
in `src/lib/email/templates.ts` — fill in the real copy there.

## Excel upload format

Any `.xlsx`/`.csv` with a header row works — columns are matched by name. Grab a
starter file from the **Download the template** link in the upload dialog.

- **Quote header** columns: `Customer` (required), `Quote Number`,
  `Project`/`Description`, `Category`, `Date Received`, `Notes`, and optional
  `Tax Rate %` / `Markup %`.
- **Line items & pricing** (optional): add `Item Type`, `Item Description`,
  `Qty`, `Unit`, `Unit Price`, and `Amount` columns to import a full quote
  document. Rows that share the same **Quote Number** roll up into a single
  quote with many line items — repeat the header fields on the first row of each
  quote and leave them blank on the continuation rows.
- **Item Type** is either `Line Item` (customer-facing, shown on the quote PDF,
  priced from `Amount`) or `Pricing` (internal cost worksheet, priced from
  `Qty × Unit Price`, never shown to the customer). A blank type defaults to
  `Line Item`. A quote's bid value is recalculated from its line items.

If a sheet has no line-item columns, each row imports as one simple pipeline
quote, exactly as before (matched on Customer / Project / Category / Bid Value).

## Brand

Colors and logo from the Cornerstone Brand Guidelines — primary green
`#98C73A`, secondary gray `#777777`.
