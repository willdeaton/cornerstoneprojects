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
- **Billing** — the desk between "the work is finished" and "the money is in",
  and a page that stands on its own: **opening a job's row bills it right
  there** — its invoice ledger, its stage decisions, all of it inline — so a
  pass down the queue never leaves the page. Marking a job **Completed** stamps
  its completion and puts it on the billing queue; from there it moves itself
  along as the invoices are ticked **Sent** and **Paid**.
  - **One row per invoice**, carrying everything the desk has to answer for:
    the invoice number, the customer's **PO number**, the **amount billed**,
    the **date it was sent**, whether it has been paid, and the **invoice PDF**
    that went out. Ticking Sent fills in today's date; typing a date is the
    other way of saying it went out. The PDF lives behind the billing gate
    rather than in the job's Files tab — an invoice is A/R paperwork.
  - **Mark billed / mark paid, with no invoicing details** — plenty of work is
    invoiced and collected outside this app, and a queue that demands an invoice
    number, a PO and a send date before a finished job can leave it is a queue
    people stop updating. One click marks every invoice on the job sent, or sent
    and paid; a job with nothing raised against it gets one invoice for its
    contract value, with no number, PO or PDF. It writes an ordinary invoice row
    rather than a special "billed anyway" flag, so every figure and every stage
    follows from it exactly as if it had been typed — and the ledger is where it
    gets a number later, or gets undone.
  - **Left to bill** — the contract value less what has actually gone out,
    shown on the invoice card as you type, on the job's billing card, and per
    job and desk-wide on the Billing page. An invoice raised but not yet sent
    still counts as left to bill, which is the honest reading.
  - **The stage is derived, never stored** — it falls out of the job's status
    and its invoice rows, so there is no second thing to keep in step. Tick an
    invoice Paid on the project and the job leaves the outstanding queue by
    itself. The stages are **Ready to Bill** (finished, nothing sent) →
    **Invoiced** (out, money still owed) → **Paid**, plus **On Hold** and
    **Closed**.
  - **Aging** — a job is aged from when it was *completed*, not from the end
    date somebody typed for the work. Billing that hasn't gone out is chased in
    days (7 to watch, 14 is late); an invoice that's out is measured against
    normal net-30 terms (30 / 45). Late jobs ring their badge and are counted
    under **Needs Chasing**.
  - **Contract vs. invoiced** — the queue calls out a job billed short of its
    contract value, one billed *over* it (worth checking for a change order),
    and money sitting on an invoice that was raised but never sent.
  - **On Hold** — a job that shouldn't be chased (retainage, a dispute, a
    customer waiting on paperwork) is parked with a reason, and stops being
    counted late. The reason is required — the point of a hold is that the next
    person through the queue knows why nobody is on it.
  - **Close Out** — signing a job off the billing desk is a deliberate act, not
    something the invoices imply: a fully paid job still wants a final look, and
    a no-charge job closes with nothing raised at all. Closing is allowed with a
    balance outstanding (a write-off has to be able to leave the queue) and the
    page says so rather than blocking it.
  - Admins and managers only — what every customer owes is not an employee's view,
    which is the same line Settings draws. The desk and the job's Billing tab
    render the same components against the same actions, so billing reads and
    behaves identically whichever way you came at it; the job page is still
    there for everything that isn't billing.
- **Schedule** — scheduling is two steps, in two views over the same data.
  **Job Timeline** plans the *work*: each job is a set of phases carrying a
  duration in working days, who does it — our own crew as a headcount, or a
  named subcontractor — and optional links between phases. **Crew Week** then staffs that work: one row
  per employee, one column per day, with the work still to staff sitting above the
  grid as cards, each filed under the column of the week it starts in.
  Weekends and non-working days never count toward a duration and are drawn as
  breaks, so work carrying into the next week reads as separate stretches rather
  than continuous weekend work — until a weekend is deliberately opened up and
  worked.
  - **Plan the work, then staff it** — the timeline never names our own people.
    A phase says "2 people for 4 days", which is a budget of 8 crew-days; the
    crew week spends that budget by booking real people onto real days. The
    budget is a *total*, not a per-day quota, so four people Monday and one
    Friday is a legitimate way to cover a 2-crew, 5-day phase — which is how a
    week usually falls. A day carrying more people than planned is flagged,
    never blocked, and nothing can be booked past the total.
  - **Subcontracted phases** — a sub *is* picked on the timeline, because that's
    when the work is contracted. Mark a phase as a subcontractor's and choose
    them, and they're on site every working day of it: their dates follow the
    phase, so a phase that slips takes them with it and there's nothing to
    re-book. A subcontracted phase can still carry a headcount for the people we
    send alongside them — the supervisor — which the crew week books as usual.
    Subs appear in the crew week (tick "Include subs") with their contracted days
    shown dashed and un-clickable, and the same sub on two different jobs over
    the same days is flagged as a double-booking exactly like an employee.
  - **Staffing a week** — pick a job card, then click the day cells of the
    people working it; the card counts its crew-days down as you go, and cells
    stop offering to book once the phase is full. Drag a card onto a day to book
    that day, or onto somebody's name to put them on every working day of the
    phase on screen. Taking somebody back off is the **×** in the corner of
    their booking — clicking the booking itself opens the job.
  - **A job across several days at once** — with a card picked (or by grabbing a
    booking somebody already has), press and drag sideways along their row: every
    day the drag covers is booked in one pass, as far as the phase's budget goes.
  - **Weekends when they're needed** — Saturday and Sunday stay off the grid
    until you press **Show weekends**, or somebody is already booked on one, so a
    normal fortnight is ten columns wide and nobody reads a weekend into the
    plan. A weekend that is worked is bookable like any other day, ringed amber,
    and shown to the crew on their own schedule. It doesn't eat the weekdays'
    budget either: an extra day of work brings an extra day of crew with it,
    while durations stay measured in working days.
  - **Who has worked a phase** — the phase editor on the timeline carries a
    synopsis of the crew days actually booked: everybody who has been on it with
    their day count and the stretches they worked, then the phase day by day with
    the names on each. Days an edit in progress would push outside the phase are
    called out, because those are the bookings about to be dropped.
  - **One booking, one card** — a run of days somebody works on the same job at
    the same time is drawn as a *single* card across those columns, because it is
    one visit rather than one chip per day: two days on a job that week reads as
    one two-day card, and the card says how many days it covers. A different
    start time on one of the days breaks the run into its own card, since a card
    that spans days is stating one shift for all of them — and so does a week
    boundary, which the grid bands apart anyway. Cards a person has on
    overlapping days stack in lanes, so a two-day job and the half day beside it
    each keep a line of their own.
  - **Job cards** — click a booking on the grid, or a phase's ⋯ above it, and the
    job opens: what was sold (proposal number, service, job, phase, location,
    value), the crew-days it carries and who is on it, the days it runs week by
    week with that person's days marked, the time the crew starts — a different
    time on any individual day, for a 6 AM delivery or a late inspection — the
    notes they read before turning up, and the job's own crew notes. Most of it
    lives here rather than on the timeline because none of it makes sense without
    the days in front of you. Clicking never removes anything: taking somebody
    off a day is the **×** in the corner of the card, and a phase on a finished
    job opens read-only, as the record of a week that has been worked.
  - **The Warehouse card** — a card that is always there, beside the "Work to
    staff" heading rather than filed under a week, because warehouse work
    doesn't start in one. Somebody has to load out, take the delivery and put
    the stock away whatever is on site, so the card takes any day of any of our
    own people and never fills up: no customer, no phases, no crew budget. It
    is deliberately not a job — a project invented to hold it would land on the
    billing desk and in the dashboard's counts. Book it exactly like a phase:
    pick it and click days, drag it onto a day, drag it onto a name for every
    working day on screen, or drag sideways along a row. Subs never appear on
    it — they're contracted to a job's phase on the timeline. A warehouse day
    alongside a job isn't counted as a double-booking (loading out in the
    morning and driving to site after is an ordinary day), it carries no start
    time or phase notes of its own, and it isn't part of publishing: there are
    no customer dates to baseline, and the employee sees it on their own week
    as soon as it's saved.
  - **Every job on the board** — jobs with nothing scheduled are listed too,
    with their status, so it's obvious which ones haven't been planned yet.
    Expand a job for its phases; collapsed, it still shows the stretch its work
    covers. Each phase row reads either "2 people × 4 days" plus how much of
    that the crew week has covered, or the subcontractor carrying it, and the
    board can be filtered to phases still needing crew.
  - **Whole weeks from Monday** — the Week, 2-Week and 6-Week views always start
    on a Monday and run to a Sunday, with each week's Monday held in a band
    above its days, so the same weekday is always in the same column.
  - **Change reasons** — moving a phase's dates, duration or link *always*
    requires a typed reason, published or not. It's kept in the job's change
    history with an auto-generated summary of what moved ("Start Mar 3 → Mar 5;
    Duration 5 → 7 working days"), readable from the job or the timeline.
    Marking a phase in progress or complete is progress, not a schedule change,
    and needs no reason. Booking crew never needs one either — who turns up is
    exactly what a manager is expected to keep adjusting.
  - **Draft, Save, Publish** — the schedule is a draft while it's being worked
    on. Edits (phases, bookings, start times, crew notes) collect in the browser,
    the board redraws from them at once, and they're written to the database
    every ten seconds or the moment you hit **Save**. Saving emails nobody, so a
    week can be planned and re-planned without anything going out.
    **Publish & Send** is what tells people: it baselines each job's dates as
    the version its crew is working to and emails everyone booked on that work
    their own days — the only schedule email the app sends. The bar above the
    views keeps count of unsaved changes and of the jobs whose dates have moved
    since they were last published, and the publish dialog lists exactly who
    will be emailed before anything is sent. A single job can be published from
    its row on the timeline. After a publish, changes to the headcount, the
    subcontractor, start times and phase notes need a reason too.
  - **Moved work drops stale bookings** — shortening or moving a phase releases
    anyone booked on days it no longer covers, across the whole job, since a
    phase that slips takes everything after it along.
  - **Hard finish date** — a date a job *must* be done by, separate from the due
    date it's aimed at. The schedule warns whenever the planned work runs past
    it, and moving a date that was already promised is recorded with a reason.
  - **Site address & crew notes** — each job carries the full address crews drive
    to (with a directions link) and a **Crew Notes** list — gate codes, parking,
    who to ask for on site — written by managers and read by everyone booked on
    the job.
  - **Double-bookings** — crew is booked a day at a time, so someone running one
    job Monday and Wednesday and another on Tuesday is not a clash. Only days
    genuinely shared between two different jobs are flagged.
  - **Overlapping phases** — a phase can start a set number of working days
    after the previous phase *starts* (start-to-start), instead of waiting for
    it to finish, so a sub can work alongside the crew ahead of them.
  - **Status board (TV)** — `/tv`, the schedule for a screen on the office wall.
    Full-bleed and dark, with no sidebar and nothing to click: it rotates between
    **today** — every job with somebody on it, the time they start, the crew by
    name, the site address, plus the next day with work, who's in the warehouse
    and who isn't booked — and the **job timeline**, the same phase bars the
    Schedule draws, one row per job over the next few weeks. Anything worth
    interrupting a room for sits across the top: a double-booking, a job planned
    past its hard finish date, crew days still to book on work starting within
    the week. It re-reads the schedule every 90 seconds, rolls itself over at
    midnight, keeps the screen awake, and pages through the jobs rather than
    shrinking them. The URL carries the settings: `/tv?panel=today` or
    `?panel=timeline` pins one screen, `?rotate=40` slows the turnover, `?weeks=6`
    shows a longer timeline. It's a signed-in page like every other — sign the TV
    in once as a manager or admin — and it only ever reads: nothing on it can
    change a booking. Open it from the **TV board** button on the Schedule.
  - **My Schedule** — employees get their own week: one card per day they're
    booked, showing the start time, the job, the address, the phase notes and
    the crew notes, with arrows to step through the weeks. A day in the
    warehouse shows the same way, with no address to drive to.
- **Time Clock** — crew clock in/out of jobs, a live timer, weekly hours, "my
  recent time," and a live "on the clock now" panel.
- **Users & Auth** — email/password login, sign out, and user management
  (add users, set roles, reset passwords, deactivate). Roles: **admin**,
  **manager**, **employee** — an employee gets the time clock and their own
  schedule, nothing else. User management lives under **Settings → Users**.
  Being scheduled is its own switch there — **Remove from scheduling** keeps
  somebody out of the crew week entirely (an estimator, an office manager,
  anyone who clocks in but isn't crew) without touching their access or their
  time. Days they are already booked on are left exactly where they are, and
  they still show in the crew week while those days stand.
- **View as role** (admins only) — a "View as" switcher in the sidebar lets an
  admin preview the app exactly as a **manager** or **employee** would see it
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

| Role     | Email                    | Password         |
| -------- | ------------------------ | ---------------- |
| Admin    | wdeaton@dlomgroup.com    | `cornerstone2026`|
| Employee | mike@dlomgroup.com       | `welcome123`     |
| Employee | dave@dlomgroup.com       | `welcome123`     |

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

Automated email (sender identity, per-user subscriptions, and event-driven
new-project / job-completion notifications) is built in.

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
- **Event-driven emails** are sent inline from the action that triggers them —
  no scheduler or cron config required:
  - **New project** — sent when a quote is marked sold and converted into a
    project (single or bulk convert).
  - **Job completion** — sent when a project's status is set to *completed*.

  Both are best-effort: an email failure never blocks the underlying action.
  Send a test message with `POST /api/test-email`.

Email body/HTML content is authored in `src/lib/email/templates.ts`.

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
