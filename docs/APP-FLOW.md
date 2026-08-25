# Cornerstone Project Tracker — App Breakdown & Flow Prompt

Two things live in this file:

1. **[Part A — The breakdown](#part-a--the-breakdown)**: what the app is, every
   section, what information each one holds, and how the sections feed each
   other. Written from the code, not the marketing copy.
2. **[Part B — The flow prompt](#part-b--the-flow-prompt)**: a self-contained
   prompt to paste into any AI tool to get a flow diagram / walkthrough of the
   app. It carries its own facts, so it works in a fresh chat with no access to
   this repo.

---

# Part A — The breakdown

## What it is

A single Next.js 15 (App Router) + TypeScript app for **Cornerstone Facility
Solutions**, backed by one PostgreSQL database over the `pg` driver. It follows
one job across its whole life: **quote → sold → scheduled → worked → billed →
paid**. Around that spine sit time tracking, payroll approval, a customer/price
catalog, and a data export.

- **Stack**: Next.js 15, React 19, Tailwind, `pg`, Recharts (dashboard charts),
  SheetJS (`xlsx`) + JSZip + html2pdf (backup export & quote PDFs), bcryptjs.
- **No ORM, no API layer for the UI.** Server Components read the database
  directly through `src/lib/data.ts` / `src/lib/schedule-data.ts`; mutations go
  through **Server Actions** in `src/app/actions/*.ts`. The handful of route
  handlers under `src/app/api/` exist only for things actions can't do —
  streaming a file blob, returning a JSON payload to client-side code.
- **Schema is self-applying.** `src/lib/db.ts` runs an idempotent `migrate()` on
  first connection: `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`,
  plus marker-guarded backfills. There is no migration tool and no `migrations/`
  folder — the file *is* the schema history, and it is safe to re-run.
- **One background job.** `src/instrumentation.ts` starts the weekly
  time-approval email scheduler (Node runtime only). Everything else is
  request-driven.

### The one architectural idea worth knowing

**Derived state, never stored state.** Three of the app's hardest features
refuse to keep a second copy of anything:

| Thing | Where it would be stored | Where it actually comes from |
| --- | --- | --- |
| A job's **billing stage** | a `billing_stage` column | `src/lib/billing.ts`, computed from `projects.status` + the job's invoice rows + two deliberate flags (hold, close-out) |
| A phase's **real start/end dates** | `start`/`end` columns | `src/lib/schedule-math.ts` `computeSchedule()`, resolved from each phase's *earliest* start, its duration in working days, and its link to a predecessor |
| A subcontractor's **days on site** | booking rows | every working day of their phase's derived window |

The payoff: tick an invoice Paid and the job leaves the billing queue by itself;
push one phase out and everything downstream moves with it. Nothing can go
stale, because there is no second thing to keep in step. The cost: these are
pure modules that must import no server code, because the same functions run
server-side *and* in the client-side live previews.

## Roles — the access spine

Three roles, checked everywhere off one **effective** role.

| Role | Sees |
| --- | --- |
| **admin** | Everything. Only role that can unpublish a schedule, delete users, or promote to admin. |
| **manager** | Everything except the admin-only actions above. Billing, Timesheets, Settings all included. |
| **employee** | Time Clock and their own Schedule. Nothing else — no dashboard, quotes, projects, timesheets, settings, and never who else is on the clock. |

A `worker` role used to sit between manager and employee (the dashboard, quotes
and projects, but no billing, timesheets or settings). It was retired and folded
into `employee`; `db.ts` migrates any remaining rows on boot.

**`View as` (admins only)** — `src/lib/auth.ts` `getCurrentUser()` swaps the
user's effective `role` for a previewed one from the `cs_view_as` cookie, while
keeping `realRole` intact. Because every gate in the app reads `role`, the
preview applies to nav, page redirects, and server actions automatically with no
per-feature work. It can only ever *lower* access — the cookie is honoured only
when the real role is `admin`, and only for `manager`/`employee`.

Auth itself is a plain httpOnly session cookie (`cs_session`) → `sessions` row →
user, 30-day expiry, bcrypt password hashes.

## The sections, and what's in each

### Dashboard `/dashboard`
Read-only rollup. Four KPI tiles (total pipeline, open pipeline,
sold/in-progress, win rate = sold ÷ (sold + open)), then quote value by week for
the last 8 weeks, sold-by-status, pipeline by customer (top 10), and quotes
decided in the past 14 days. One `getDashboard()` call fires all its queries
concurrently. Blocked for `employee`.

### Quotes `/quotes`
The prospective pipeline, tabbed Open / Sold / Lost / All.

A quote row is both a **pipeline record** and, optionally, a **full
customer-facing document**. `quotes` carries the header (customer, contact,
addresses, issue date, valid-until, terms, prepared by, internal notes,
markup rate) and `quote_line_items` carries three *kinds* of row:

- `display` — customer-facing lines, printed on the PDF, priced from `amount`.
- `pricing` — the internal cost worksheet, priced from `qty × unit_price`, never
  shown to the customer.
- `alternate` — lines belonging to a named **pricing option** (`option_group`),
  each option totalled on its own so two options never sum together.

**Quote builder** (`QuoteBuilder.tsx`, the largest component in the app) edits
all of this in one screen, pulls customers/contacts/units/categories/price-book
items from the Settings catalogs, and offers to save new worksheet rows *back*
into the price book on save. Money math lives in `src/lib/quote-math.ts` — markup
is **per line**, rounded to cents so the printed total always equals the sum of
the printed lines. There is no tax.

**`/quotes/[id]/print`** renders the customer PDF (company info and logo come
from Settings). Quote files can be attached for internal reference only, and are
never printed.

**The hand-off**: marking a quote **Sold** calls `convertQuoteToProject()` — one
transaction that inserts a `projects` row (carrying quote number, customer,
name, category, bid value, and a site address taken from the quote's project
location or the customer's address), flips the quote to `sold`, and commits. It
also fires the new-project email. This is the *only* bridge between the two
halves of the app, and it's one-way.

### Projects `/projects` and `/projects/[id]`
Sold work, tabbed Active / Not Started / In Progress / Completed / All. The list
shows status, progress, value, hours logged, due date, and — for admins and
managers only — each job's derived billing stage badge.

The **detail page** is the busiest screen in the app and the hub everything else
hangs off:

- **Status & progress** — setting status to `completed` stamps `completed_at`,
  which is what puts the job on the billing desk and starts its aging clock.
  (Reopening clears the stamp.) It also fires the job-completion email.
- **Invoices** — one `project_invoices` row per invoice: the invoice number, the
  customer's **PO number**, the amount, the day it was **sent** (`sent_on`), two
  independent flags — **billed** (it has gone out) and **paid** (money landed) —
  and the **invoice PDF** in `invoice_files` (one per invoice, keyed by it, so a
  re-upload replaces it). `billed` stays the flag the pipeline reads; `sent_on`
  is the paperwork date, kept in step with it (a date implies sent, clearing
  sent clears the date). The card is `src/components/billing/InvoiceSection.tsx`,
  and the Billing desk renders the same one inline — so this ledger is edited the
  same way from either place.
- **Contract value & change orders** — `projects.value` is the one live contract
  value every reader reads, but it only moves as a recorded act: a required
  reason, an optional CO number, and a `project_value_changes` row per change,
  written in the same transaction as the value under a `SELECT … FOR UPDATE` so
  two change orders landing together chain instead of both quoting the stale
  figure. **Sold at** is derived from the earliest row, never stored. Admins and
  managers only, and refused outright once billing is `paid` or `closed` —
  `contractLocked()` is a pure predicate in `src/lib/billing.ts`, so the control
  that offers the change and the action that performs it can't disagree. It is
  deliberately not on the Edit Project form any more, and `updateProject()` will
  not write the field at all.
- **Billing card** — the derived stage, aging, what's **left to bill** (contract
  less what has gone out) and the contract-vs-invoiced variance, plus the stage
  decisions this card offers (`BillingStageControls`, shared with the Billing
  desk): put billing **on hold** (reason required), and the short path — **mark
  billed** / **mark paid** with no invoice detail entered at all. Closing a job
  out is not a button on this card — signing a job off the billing desk is the
  desk's own act — though a job already closed out can still be reopened here.
- **Job notes** — internal, staff-facing.
- **Crew notes** — separate table, written *to be read by the crew*: gate codes,
  parking, who to ask for. Pinned notes stay on top. These surface on every
  booked person's own schedule and in the schedule email.
- **Schedule section** — the job's phases, its projected finish (derived), its
  hard finish date, whether it is **on hold** (and what it's waiting on), and its
  change history.
- **Time** — every entry logged against this job, and total hours.
- **Files** — attachments, stored as base64 in the database, streamed back via
  `/api/files/[id]`. Invoice PDFs deliberately do *not* live here: they're in
  `invoice_files` behind `/api/invoices/[id]/pdf`, which is gated to
  admins/managers rather than to "not an employee" — the Files tab is a wider
  audience than the Billing tab.
- **Site address** — the full mappable address crews drive to, kept separate
  from `location` (the short "City, ST" label used on quotes and lists), with a
  Google Maps directions link.

### Billing `/billing` — admins & managers only
A queue you work *in*. Opening a row brings that job's whole billing down into
the page — the same invoice ledger and the same stage controls the job's Billing
tab uses (`src/components/billing/`), fetched a job at a time as rows are opened
rather than shipped with the page. So a pass down the queue never leaves it, and
a job that gets settled leaves the tab it was in as you go. The job page is
still there for everything that isn't billing.

Stages, all derived in `src/lib/billing.ts`:

```
not_ready → ready_to_bill → invoiced → paid
                 ↕                ↕
              on_hold          closed
```

Precedence matters: closed wins over everything; fully paid beats a stray hold;
a job invoiced part-way through the work is already in the pipeline before it's
complete, which is how progress billing works.

**Aging** runs from `completed_at` (when the job hit the desk), never from an
end date somebody typed. Two different clocks: billing that hasn't gone out is
chased in days (**7** to watch, **14** late); an invoice that's out is measured
against net-30 terms (**30** / **45**). Late jobs are counted under *Needs
Chasing*.

It also calls out three money variances: a job billed **short** of its contract
value, one billed **over** it (worth checking for a change order), and money
raised on an invoice that was never actually sent.

**Left to bill** — contract value less what has actually gone out — is shown per
job and totalled desk-wide. It is wider than the short-billed variance on
purpose: an invoice raised but never sent is still work left to bill.

**Mark billed / mark paid** is the short path for work invoiced and collected
outside the app: no invoice number, no PO, no send date, no PDF. It marks every
invoice on the job sent (and paid, when asked), and for a job with nothing
raised against it, raises one invoice for the contract value. What it writes is
an ordinary `project_invoices` row — deliberately *not* a "billed anyway" flag —
so the stage, the aging and every total follow from it with no special case
anywhere, and it is undone by editing that row in the ledger like any other.

### Schedule `/schedule`
Two views over one load of the same rows, and the split between them is the
whole design.

**Job Timeline — plans the *work*.** A job is an ordered set of **phases**
(`schedule_tasks`), each carrying: an *earliest* start, a duration in **working
days**, an optional link to a predecessor (`finish_to_start` or
`start_to_start`, plus a lag), a status, notes, a daily shift, and either a
**headcount** (`crew_size`) of our own people or a named **subcontractor**.

The timeline never names our own people. A phase says *"2 people for 4 days"* —
a budget of 8 crew-days. Real dates are never stored; `computeSchedule()`
resolves them depth-first from the chain (`start = max(own earliest, anchor +
lag)`), memoized, with cycles detected and reported rather than looped.

**Crew Week — staffs that work.** One row per employee, one column per day, with
unstaffed work sitting above the grid as cards filed under the week they start
in. `schedule_crew_days` is one row per person per day per phase. The budget is
spent as a **total**, not a per-day quota — four people Monday and one Friday is
a legitimate way to cover a 2-crew 5-day phase, which is how a week usually
falls. A day carrying more people than planned is **flagged, never blocked**;
nothing can be booked past the total. Staff by clicking day cells, dragging a
card onto a day, dragging it onto a name (books every working day of the phase
on screen), or press-and-drag sideways along a row to book a span in one pass.

A booking is drawn as **one card across the days it covers**: consecutive
columns of the same phase, on the same shift, in the same week are one card
rather than one chip per day (`buildSpans` in `CrewWeek.tsx`, with a lane per
stacked card so overlapping bookings each keep a line). Clicking a card **opens
the job** — details, days, shift, crew notes, read-only on a finished job —
and taking somebody off a day is the **×** in the card's corner, so the
destructive action is the deliberate one.

The **Warehouse** card is the one card that isn't a phase: `warehouse_days` is
one row per person per day, with no window, no budget and no project, so the
card sits beside the band's heading instead of under a week and is always
available. It books through the same draft (`warehouse-book` /
`warehouse-unbook` edits, replayed server-side by `bookWarehouseDaysAction`),
takes our own people only, and is outside publishing — nothing about it
baselines a job's dates or emails a crew.

Rules that fall out of this model:

- **Weekends** stay off the grid until you press *Show weekends* or somebody is
  already booked on one, so a normal fortnight is ten columns wide. A worked
  weekend is bookable, ringed amber, and brings its *own* extra day of budget
  rather than eating the weekdays'.
- **Subcontracted phases** — the sub is chosen on the *timeline*, because that's
  when the work is contracted. Their days are derived from the phase window, so
  a phase that slips takes them with it and there's nothing to re-book. A
  subcontracted phase can still carry a headcount for the supervisor we send.
- **All day by default** — a job books for the whole day unless somebody gives
  it **hours** on its crew-week job card (`schedule_tasks.hours`, null = all
  day; per-day overrides in `schedule_task_day_times`). A start time plus hours
  is a *bounded shift*: 8:00 for 4 hours ends at noon.
- **Split days** — one person at two places in a day is a plan, not a mistake:
  book them 8:00–12:00 on one job and 12:00–4:00 on another and the grid tints
  the cell amber and calls it a split day. All day (the default) still takes the
  whole day, so two of those clash as they always did.
- **Double-bookings** — crew is booked a day at a time, so one job Monday and
  Wednesday plus another on Tuesday is *not* a clash. A shared day across
  *different* jobs is only flagged when the **hours actually collide** (two
  phases of the same job may overlap freely). Touching ends don't: a shift
  ending at noon and one starting at noon is exactly the split above.
- **Moved work drops stale bookings** — shortening or moving a phase releases
  anyone booked on days it no longer covers, across the whole job.
- **Change reasons** — moving a phase's dates, duration or link *always* needs a
  typed reason, published or not, logged to `schedule_changes` with an
  auto-generated summary ("Start Mar 3 → Mar 5; Duration 5 → 7 working days").
  Marking a phase in progress or complete is *progress*, not a schedule change,
  and needs none. Booking crew never needs one. **Publishing** marks the dates
  the crew has; after that, changes to headcount, subcontractor, shifts and
  phase notes need a reason too.
- **Hard finish date** — a date the job *must* hit, separate from the due date
  it aims at. The schedule warns whenever derived work runs past it.
- **On hold** — `projects.on_hold` (+ `on_hold_reason`, `on_hold_since`), set
  from the timeline, the job's Schedule tab or its Overview. Deliberately NOT a
  status: an on-hold job keeps `status`, its dates, its phases, its place on the
  board and its place in the counts. The flag records that nothing is waiting on
  *us* — the GC, the owner or another trade is what it is waiting on — and the
  reason is required, since a bare "on hold" is unreadable a fortnight later. It
  is badged on the timeline block, flagged on the crew week card, and shown on
  the job with how long it has been parked.
- **Finished jobs stay correctable** — jobs marked complete are loaded back as
  far as `HISTORY_WEEKS` and drawn on the weeks they ran, out of every count of
  work still to plan or staff. Both views still allow edits: a plan or a record
  entered wrong has to be fixable without reopening the job. The timeline gates
  a phase edit behind a dialog naming the job and the change; the crew week
  confirms each booking and each card edit. Everything is logged to
  `schedule_changes` with a reason like any other schedule change.

Views run in whole Monday-to-Sunday weeks (Week / 2-Week / 6-Week, defaulting to
2), so the same weekday is always in the same column. Each job on the timeline is
its own block, with a colour of its own down its left edge and across its header
band, so one job can be followed across a six-week view. The ‹ › arrows step
**one week per press** whatever width is on screen — a wide view that paged by
its own width skipped everything between — and **This Week** returns to today.

**My Schedule** is what an employee gets instead: a read-only week of their own
bookings — one card per day, with the shift ("All day", or "8:00 AM – 12:00 PM ·
4h" on a split day), job, address, phase notes and crew notes, and arrows to
step weeks. Their warehouse days appear on the same day cards, above the jobs
and without an address.

**Status board** `/tv` is the same rows for a wall screen. Deliberately outside
the `(app)` group — the sidebar, the "view as" switcher and the backup reminder
are all things you click, and none belong on a TV — so what's left is the
schedule itself, dark and full-bleed, rotating through three screens: **today**
(a card per job with crew on it), the **crew week** (a row per person over a
Monday-anchored fortnight, weekends off the grid unless worked, a run of days on
one job at one shift drawn as one card, double-bookings ringed), and the **job
timeline** (a row per job, phase bars over the weeks ahead). It derives
everything through `computeSchedule()` / `assigneeBookings()` exactly as the
Schedule does (`src/app/tv/tv-board.ts` shapes the day, the alerts, the crew rows
and the timeline rows; it holds no queries and no state), refreshes itself every
90s, rolls the day over at midnight, and takes `?panel=today|crew|timeline`,
`?rotate=<seconds>` and `?weeks=<n>` from the URL. Nothing is ever dropped to
make room: the day's cards divide and shed detail instead of hiding jobs, a bar
too narrow for its label borrows the empty columns beside it, and the crew and
timeline screens page. Pausing holds a screen and is remembered in
`localStorage`, so a TV that reloads comes back to it. Admins and managers only,
and read-only end to end.

**Send Schedule** emails each assignee their own dates only.

### Time `/time` and `/timesheets`
**Time Clock** — clock in (optionally against a job, or "general"), a live
timer, lunch breaks (`time_breaks`, so hours are net of breaks), switch job
without clocking out, weekly hours, recent entries, and an *On the Clock Now*
panel showing who's working and who's on break. Employees don't see that panel.

**Timesheets** (admins & managers) — 8 weeks of clocked hours by week and by
person, with paid/unpaid totals, mark-as-paid (with a check number), manual
entry and correction of anyone's time, and weekly approval.

**Weekly approval** is the app's one scheduled job. Every user has a
`manager_id`. A 5-minute tick checks the clock in `PAYROLL_TZ` (default
`America/Chicago`) and, Mondays from 7am, emails each manager a day-by-day
summary of every direct report's prior week with a tokenized **approve link**.
`/approve-time` is a **public** page — the token *is* the credential, no login —
and only the SHA-256 hash of the token is stored, exactly like password resets.
Tokens are multi-use until expiry so a manager can approve reports one at a
time from the same email. A settings-table run-lock keyed by the week's Monday
means exactly one worker sends, even across restarts; the claim is released if
nothing actually went out, so a failed Monday retries.

### Settings `/settings` — admins & managers only
Two flyout groups:

- **System Settings** — **Company** (name, address, phone, email, website, logos
  and default quote terms, all shown on customer-facing PDFs), **Email** (sender
  identity), **Users**.
- **Data** — **Customers** (+ named contacts, feeding the quote picker),
  **Subcontractors**, **Pricing** (the price book, plus units and categories),
  **Non-Working Days** (holidays that drop out of every duration calculation),
  **Backup**.

**Users** holds more than access: role, active flag, hourly rate, **who they
report to** (drives approval emails), personal/work email, per-user email
subscription checkboxes, and **Remove from scheduling** — which keeps an
estimator or office manager out of the crew week entirely without touching their
access or their time. Days they're already booked on are left exactly where they
are.

**Backup** — pick a date range, and the client pulls `/api/backup` (admin/manager
only) and builds a multi-sheet workbook plus the quote PDFs, zipped in the
browser. A monthly reminder nudges admins from the first Monday of each month,
covering the month that just closed, downloadable straight from the reminder.

## Email

All event-driven and inline — no cron for any of it except the Monday approval
send. Transport is the **SendGrid v3 HTTP API**, not SMTP; the key comes from
`SENDGRID_API_KEY` and is never stored in the database. Nothing sends unless
both the key and a `from_email` are set. Every send is **best-effort per
recipient** — one bad address never aborts a batch, and an email failure never
blocks the action that triggered it.

| Email | Fires when |
| --- | --- |
| New project | a quote is marked sold and converted |
| Job completion | a project's status is set to `completed` |
| Welcome | an admin creates a user |
| Password reset | requested from the login screen |
| Schedule | a manager sends it out for a date range (each assignee gets only their own work) |
| Weekly approval | Monday morning, per manager, scheduled |

Recipients for the first two come from per-user subscription checkboxes;
addresses resolve `personal_email → work_email → login email`. Bodies live in
`src/lib/email/templates.ts`.

## How it all interacts — the data spine

```
                    Settings catalogs
       (customers · contacts · price book · units
        · categories · subcontractors · holidays)
                          │ feed
                          ▼
  QUOTE ──── mark Sold ────► PROJECT ──────────────────────────┐
  (pipeline + document)      (the job — the hub)               │
    │  line items:            │                                │
    │   display / pricing      ├── phases ──► derived dates ───┤
    │   / alternate(option)    │   (timeline)      │           │
    │                          │                  ▼           │
    └──► PDF ◄── company info  │            crew days ────► My Schedule
                               │            (crew week)       + schedule email
                               │
                               ├── invoices ──► DERIVED billing stage ──► Billing queue
                               │   (billed/paid)     + aging from completed_at
                               │
                               ├── notes (internal) · crew notes (crew-facing) · files
                               │
                               └── time entries ──► Timesheets ──► weekly approval
                                     (net of breaks)              (manager email + token)
                                          │
                                          └──► hours shown back on the job
```

Read it as four one-way hand-offs:

1. **Quote → Project** is the only bridge, and it's a single transaction that
   can't half-happen.
2. **Project status → Billing** is a stamp (`completed_at`), and everything
   billing shows is derived from it plus the invoice rows.
3. **Timeline → Crew Week** is plan → staff. The timeline says how much crew a
   phase needs; the crew week spends that budget on real people and real days.
4. **Crew Week → the crew** is the schedule each person sees and the email each
   person gets — only ever their own work.

Everything else is a catalog feeding the quote builder, or a report reading back
off the job.

## Known drift from the README

- The README's **Excel/CSV quote upload** (weekly file import, column
  auto-detection, template download) **is not in the code.** `xlsx` is now used
  only by the Backup export. Quotes are created manually or in the builder.
- The README doesn't mention **Timesheets**, weekly **time approval**, the
  **Backup** export, the **Customers / Pricing / Subcontractors** catalogs,
  **file attachments**, **password reset**, or the **employee** role.
- The README lists three roles; there are **four** (`employee` is the most
  restricted).

---

# Part B — The flow prompt

Everything below the line is the prompt. It is self-contained — paste it into
any AI tool, with or without repo access. Delete the bracketed options you don't
want.

---

> You are documenting an existing internal web application so a new person can
> understand it in one sitting. Produce a **flow-first walkthrough**: how work
> moves through the app, what information lives in each section, and how the
> sections feed each other.
>
> ## The app
>
> **Cornerstone Project Tracker** — an internal operations app for Cornerstone
> Facility Solutions, a facilities/construction services contractor. It follows
> one job across its entire life: **quote → sold → scheduled → worked → billed
> → paid**, with time tracking, payroll approval, and reference catalogs around
> that spine.
>
> Built as a single Next.js 15 App Router + TypeScript app on one PostgreSQL
> database. Server Components read the database directly; all mutations are
> Server Actions. No ORM. The schema applies itself idempotently on first
> connection, so there is no migration tool.
>
> ## The one design idea to lead with
>
> **Derived state, never stored state.** Three features refuse to keep a second
> copy of anything:
>
> - A job's **billing stage** is computed from its status + its invoice rows +
>   two deliberate flags (hold, close-out). Tick an invoice Paid and the job
>   leaves the queue by itself.
> - A schedule phase's **real start and end dates** are resolved from its
>   earliest start, its duration in working days, and its link to a predecessor.
>   Push one phase out and everything downstream moves with it.
> - A **subcontractor's days on site** are derived from their phase's window, so
>   a phase that slips takes them with it and there's nothing to re-book.
>
> Nothing can go stale, because there is no second thing to keep in step. Make
> this idea visible in the output — it explains most of the app's behaviour.
>
> ## Roles (every gate in the app reads one effective role)
>
> - **admin** — everything; only role that can unpublish a schedule, delete
>   users, or promote to admin.
> - **manager** — everything else, including Billing, Timesheets and Settings.
> - **employee** — Time Clock and own Schedule only.
>
> Admins have a **View as** switcher that swaps their effective role while
> keeping their real one, so nav, page redirects and server actions all honour
> the preview with no per-feature work. It can only ever *lower* access.
>
> ## The sections and what each holds
>
> **Dashboard** — read-only rollup: total/open pipeline, sold + in-progress,
> win rate (sold ÷ (sold + open)), quote value by week for 8 weeks,
> sold-by-status, pipeline by customer, and quotes decided in the last 14 days.
>
> **Quotes** — the prospective pipeline, tabbed Open / Sold / Lost / All. Each
> quote is both a pipeline record *and* optionally a full customer-facing
> document. Line items come in three kinds: customer-facing lines printed on the
> PDF; an internal cost worksheet never shown to the customer; and lines
> belonging to a named **pricing option**, each option totalled on its own.
> Markup is per line, rounded to cents so the printed total always equals the
> sum of the printed lines. No tax. A quote can render a branded customer PDF
> using company info and logos from Settings, and can carry internal-only file
> attachments that are never printed.
>
> **Quote → Project** is the only bridge between the two halves of the app, and
> it's one-way: marking a quote Sold runs a single transaction that creates the
> job (carrying quote number, customer, name, category, value, and a site
> address taken from the quote), flips the quote to sold, and emails everyone
> subscribed to new-project notifications.
>
> **Projects** — sold work, tabbed by status, with progress, value, hours logged
> and due dates. The **project detail page is the hub everything hangs off**:
> status and progress; **invoices** (one row each, carrying the invoice number,
> the customer's PO, the amount, the date it was sent, independent billed/paid
> flags and the invoice PDF — the same ledger card the Billing desk opens
> inline); a billing card showing the derived stage, aging, what's left to bill
> and the contract-vs-invoiced variance; internal
> **job notes**; crew-facing **crew notes** (gate codes, parking, who to ask
> for — these surface on every booked person's schedule and in the schedule
> email); the job's schedule phases and projected finish; time logged; file
> attachments; and a full mappable **site address** kept separate from the short
> "City, ST" label used on lists and quotes.
>
> Setting a job to **completed** stamps a completion timestamp. That stamp is
> what puts it on the billing desk and starts its aging clock, and it fires a
> job-completion email.
>
> **Billing** (admins & managers) — a **queue you work in**: opening a job's row
> brings its invoice ledger and its stage decisions down into the page, the same
> components the job's Billing tab uses, so a pass down the queue never leaves
> it. Stages are derived:
> `not_ready → ready_to_bill → invoiced → paid`, plus `on_hold` (parked with a
> required reason — the point of a hold is that the next person knows why nobody
> is on it) and `closed` (a deliberate sign-off, allowed even with a balance
> outstanding so a write-off can leave the queue). Precedence: closed wins over
> everything, fully paid beats a stray hold, and a job invoiced part-way through
> the work is already in the pipeline before it's complete — which is how
> progress billing works. **Aging runs from when the job was completed, not from
> an end date somebody typed**, on two clocks: billing that hasn't gone out is
> chased in days (7 watch / 14 late), an invoice that's out is measured against
> net-30 terms (30 / 45). It also calls out three money variances: billed short
> of contract, billed over it (check for a change order), and money raised on an
> invoice that was never sent — and totals **what's left to bill** per job and
> across the desk. For work invoiced and collected outside the app there is a
> short path: **mark billed / mark paid** with no invoice detail at all, which
> writes an ordinary invoice row (for a job with none, one at the contract
> value), so every derived figure follows from it with no special case.
>
> **Schedule** — two views over the same rows, and the split between them is the
> whole design:
>
> - **Job Timeline plans the *work*.** A job is an ordered set of phases, each
>   with an *earliest* start, a duration in **working days**, an optional link to
>   a predecessor (finish-to-start or start-to-start, with a lag, so phases can
>   overlap), a status, notes, a daily shift, and either a **headcount** of
>   our own people or a named **subcontractor**. The timeline never names our own
>   people — a phase says "2 people for 4 days", a budget of 8 crew-days.
> - **Crew Week staffs it.** One row per employee, one column per day, with
>   unstaffed work sitting above the grid as cards filed under the week they
>   start in. Booking is one person, one day, one phase. The budget is spent as a
>   **total, not a per-day quota** — four people Monday and one Friday is a
>   legitimate way to cover a 2-crew 5-day phase, and that's how a week usually
>   falls. A day carrying more people than planned is **flagged, never blocked**;
>   nothing can be booked past the total.
>
> Rules that fall out of that model, all worth showing:
> - Weekends stay off the grid until deliberately opened up, so a normal
>   fortnight is ten columns wide. A worked weekend brings its *own* extra day of
>   budget rather than eating the weekdays'. Durations stay measured in working
>   days, and holidays drop out of the math entirely.
> - A subcontractor is picked on the **timeline**, because that's when the work is
>   contracted — not booked day by day. A subcontracted phase can still carry a
>   headcount for the supervisor we send.
> - A job books for the **whole day unless it's given hours**. A start time plus
>   hours is a bounded shift, and that's how one person covers two sites in a
>   day: 8:00–12:00 on one job, 12:00–4:00 on another. The grid calls that a
>   *split day* rather than a clash.
> - Crew is booked a day at a time, so someone on one job Monday and Wednesday
>   and another job Tuesday is **not** a double-booking. A shared day across
>   *different* jobs is only flagged when the **hours actually collide** — which
>   two all-day bookings always do.
> - Shortening or moving a phase **releases anyone booked on days it no longer
>   covers**, across the whole job.
> - Moving a phase's dates, duration or link **always** requires a typed reason,
>   published or not, logged with an auto-generated summary of what moved.
>   Marking a phase in progress or complete is *progress*, not a schedule change,
>   and needs none. Booking crew never needs one. **Publishing** marks the dates
>   the crew has; after that, changes to headcount, subcontractor, shifts and
>   phase notes need a reason too.
> - A **hard finish date** — a date the job must hit — is separate from the due
>   date it aims at, and the schedule warns when planned work runs past it.
> - A job can be put **on hold** while it waits on somebody else — the GC, the
>   owner, another trade. It is not a status: the job keeps its status, its dates,
>   its phases and its place in the counts, and the hold records that nothing is
>   waiting on *us*. The reason is required and travels with it onto the timeline
>   block, the crew week card and the job itself.
> - **Finished jobs stay correctable.** They are drawn on the weeks they ran, out
>   of every count of work still to plan or staff, and still editable in both
>   views — a plan or a record entered wrong has to be fixable without reopening
>   the job — behind a confirmation naming the job and the change.
> - Views run in whole Monday-to-Sunday weeks (1, 2 or 6), so the same weekday is
>   always in the same column, and each job on the timeline is its own colour-led
>   block. The arrows step **one week per press** whatever width is on screen.
>
> Employees get **My Schedule** instead: a read-only week of their own
> bookings, one card per day, with start time, job, address, phase notes and
> crew notes. Managers can also email each assignee their own dates.
>
> **Time Clock** — clock in against a job or as general work, a live timer, lunch
> breaks so hours are net, switch job without clocking out, weekly hours, and a
> live "on the clock now" panel (hidden from employees, who only ever see their
> own time).
>
> **Timesheets** (admins & managers) — 8 weeks of hours by week and person, paid
> vs unpaid, mark-as-paid with a check number, manual entry and correction of
> anyone's time, and weekly approval.
>
> **Weekly time approval** — the app's only scheduled job. Every user has a
> manager. Monday mornings, each manager is emailed a day-by-day summary of
> every direct report's prior week with a **tokenized approve link** that works
> without logging in — the token is the credential, only its hash is stored, and
> it stays usable until expiry so reports can be approved one at a time. A
> database run-lock keyed to the week means exactly one process sends, even
> across restarts, and releases if nothing went out so a failed Monday retries.
>
> **Settings** (admins & managers) — *System*: company info, logos and default
> quote terms shown on customer PDFs; email sender identity; users. *Data*:
> customers and their named contacts; subcontractors; a price book with units and
> categories; non-working days; and a data backup. The catalogs all feed the
> quote builder, and new worksheet rows can be saved back into the price book.
>
> **Users** holds more than access: role, active flag, hourly rate, **who they
> report to** (which drives the approval emails), personal/work email, per-user
> email subscriptions, and a **Remove from scheduling** switch that keeps an
> estimator or office manager out of the crew week without touching their access
> or their time — while leaving days they're already booked on exactly where
> they are.
>
> **Backup** — pick a date range and the browser builds a multi-sheet workbook
> plus the quote PDFs and zips it. A monthly reminder nudges admins to pull the
> month that just closed.
>
> **Email** — all event-driven and inline (only the Monday approval send is
> scheduled), over a provider HTTP API rather than SMTP, with the key in an
> environment variable and never in the database. Every send is best-effort per
> recipient: one bad address never aborts a batch, and an email failure never
> blocks the action that triggered it. Triggers: new project (quote sold), job
> completion, welcome, password reset, schedule send, weekly approval.
>
> ## What to produce
>
> 1. **A one-paragraph orientation** — what the app is for and the single path a
>    job takes through it.
> 2. **A main flow diagram** of that path (quote → sold → scheduled → worked →
>    billed → paid), showing where each hand-off happens and what it carries.
>    Mark the hand-offs that are one-way or transactional.
> 3. **A section-by-section reference** — for each section: who can see it, what
>    information it holds, what actions it offers, and which other sections it
>    reads from or writes to. Be concrete about the fields, not just the names.
> 4. **A data-relationship diagram** showing the entities and how they connect:
>    quotes and their line items → projects → invoices, notes, crew notes, files,
>    time entries, and schedule phases → crew day bookings; plus the catalogs
>    that feed quotes, and users with their reporting lines.
> 5. **A "derived, not stored" callout** naming each derived value, what it's
>    computed from, and what would break if it were stored instead.
> 6. **A role-access matrix** — sections and key actions down one axis, the four
>    roles across the other.
> 7. **The two-step scheduling model explained on its own** — plan the work
>    (timeline, headcount as a budget) then staff it (crew week, real people on
>    real days) — including how the crew-day budget is spent, what's flagged
>    versus what's blocked, and when a change reason is required.
> 8. **The lifecycle of one example job, end to end**, as a narrative: quoted,
>    sold, phased, staffed, worked and clocked, completed, invoiced, chased,
>    paid, closed — naming which screen each step happens on and which role does
>    it.
>
> ## How to write it
>
> - Lead with flow and information, not with the file tree or the tech stack.
> - Every diagram must show the actual mechanism, not a generic box-and-arrow
>   sketch. Label the arrows with what moves along them.
> - Name the *rules*, not just the features — "aging runs from completion, not
>   from a typed end date" is the useful sentence; "has aging" is not.
> - Where a design decision has a stated reason, keep the reason. It's usually
>   the only thing that makes the behaviour make sense.
> - Call out anything you'd need to see the code to be sure of, rather than
>   filling the gap.
>
> **Format**: [pick one — a single self-contained HTML page with inline
> diagrams / a Markdown document with Mermaid diagrams / a slide outline / a
> one-page onboarding cheat sheet].
>
> **Audience**: [pick one — a new developer joining the project / the
> non-technical business owner / an operations manager being trained on the app /
> a contractor being handed the codebase].
