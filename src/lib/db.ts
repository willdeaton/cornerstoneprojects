import 'server-only';
import { Pool, types } from 'pg';
import { ensureSeed } from './seed';
import { computeSchedule, eachDay, isWorkingDay } from './schedule-math';
import type { DependsType } from './types';

/*
 * Postgres data layer.
 *
 * Connection string comes from DATABASE_URL. In local dev it falls back to a
 * localhost Postgres so `npm run dev` works without extra setup. On hosted
 * platforms (Railway, Render, Supabase, Neon, …) set DATABASE_URL and the
 * app will use SSL automatically.
 */

const DEFAULT_URL = 'postgresql://postgres:postgres@localhost:5432/cornerstone';

// Keep dates/timestamps as strings so the existing string-based types and the
// formatters in ./format.ts keep working unchanged.
//   1082 = date               -> raw 'YYYY-MM-DD'
//   1184 = timestamptz        -> ISO 8601 string ('…T…Z')
//   20   = int8 / bigint      -> number (COUNT(*) etc. otherwise arrive as text)
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1184, (v) => new Date(v).toISOString());
types.setTypeParser(20, (v) => parseInt(v, 10));

const g = globalThis as unknown as { __cspg?: Pool; __cspgInit?: Promise<void> };

function needsSsl(url: string): boolean {
  if (process.env.PGSSL === 'false') return false;
  if (/sslmode=disable/.test(url)) return false;
  // Local connections don't use SSL; hosted ones generally do.
  return !/localhost|127\.0\.0\.1/.test(url) || process.env.PGSSL === 'true';
}

function createPool(): Pool {
  const url = process.env.DATABASE_URL || DEFAULT_URL;
  return new Pool({
    connectionString: url,
    ssl: needsSsl(url) ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
}

/** Get the shared pool, running migrations + seed exactly once per process. */
export async function getDb(): Promise<Pool> {
  if (!g.__cspg) {
    const pool = createPool();
    g.__cspg = pool;
    g.__cspgInit = (async () => {
      try {
        await migrate(pool);
        await ensureSeed(pool);
      } catch (err) {
        // If init fails (e.g. the DB wasn't reachable yet), reset so the next
        // call retries instead of caching a permanently-rejected promise.
        g.__cspg = undefined;
        g.__cspgInit = undefined;
        await pool.end().catch(() => {});
        throw err;
      }
    })();
  }
  await g.__cspgInit;
  return g.__cspg!;
}

async function migrate(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin','manager','employee')),
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id            SERIAL PRIMARY KEY,
      quote_number  TEXT,
      customer      TEXT NOT NULL,
      project_name  TEXT,
      category      TEXT,
      bid_value     DOUBLE PRECISION NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','sold','lost')),
      date_received DATE,
      week_of       DATE,
      source        TEXT NOT NULL DEFAULT 'manual',
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS quote_line_items (
      id          SERIAL PRIMARY KEY,
      quote_id    INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      position    INTEGER NOT NULL DEFAULT 0,
      kind        TEXT NOT NULL DEFAULT 'display',
      description TEXT NOT NULL,
      quantity    DOUBLE PRECISION NOT NULL DEFAULT 1,
      unit        TEXT,
      unit_price  DOUBLE PRECISION NOT NULL DEFAULT 0,
      amount      DOUBLE PRECISION,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id              SERIAL PRIMARY KEY,
      quote_id        INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
      quote_number    TEXT,
      customer        TEXT NOT NULL,
      name            TEXT NOT NULL,
      category        TEXT,
      value           DOUBLE PRECISION NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed')),
      progress        INTEGER NOT NULL DEFAULT 0,
      location        TEXT,
      start_date      DATE,
      end_date        DATE,
      due_date        DATE,
      invoice_numbers TEXT,
      invoice_notes   TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS notes (
      id          SERIAL PRIMARY KEY,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      body        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id          SERIAL PRIMARY KEY,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      clock_in    TIMESTAMPTZ NOT NULL,
      clock_out   TIMESTAMPTZ,
      note        TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS project_files (
      id            SERIAL PRIMARY KEY,
      project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      filename      TEXT NOT NULL,
      mime          TEXT,
      size          INTEGER NOT NULL DEFAULT 0,
      data          TEXT NOT NULL,
      uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      uploader_name TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Supporting documentation attached to a quote for INTERNAL reference only
    -- (never shown on the customer PDF). Mirrors project_files: the file bytes
    -- are stored inline as a base64 data URL in the data column.
    CREATE TABLE IF NOT EXISTS quote_files (
      id            SERIAL PRIMARY KEY,
      quote_id      INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      filename      TEXT NOT NULL,
      mime          TEXT,
      size          INTEGER NOT NULL DEFAULT 0,
      data          TEXT NOT NULL,
      uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      uploader_name TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS time_breaks (
      id            SERIAL PRIMARY KEY,
      time_entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
      break_start   TIMESTAMPTZ NOT NULL,
      break_end     TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Document fields added to quotes so a pipeline record can also be a
    -- full customer-facing quote. ADD COLUMN IF NOT EXISTS keeps this safe to
    -- run against databases created before these columns existed.
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_contact  TEXT;
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_email    TEXT;
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_phone    TEXT;
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_address  TEXT;
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS project_location  TEXT;
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS issue_date        DATE;
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS valid_until       DATE;
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS tax_rate          DOUBLE PRECISION NOT NULL DEFAULT 0;
    -- Optional overall markup applied to the subtotal (before tax). Stored as a
    -- fraction (0.15 = 15%). Hidden from the customer PDF — it's folded into the
    -- printed line prices so the shown subtotal/tax/total stay consistent.
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS markup_rate       DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS terms             TEXT;
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS prepared_by       TEXT;
    -- Internal-only notes kept alongside the quote for the team's reference.
    -- Never rendered on the customer-facing PDF.
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS internal_notes    TEXT;

    -- Line items split into an internal pricing worksheet ('pricing', hidden
    -- from the customer PDF) and customer-facing lines ('display', shown on the
    -- PDF with a description and total price). Existing rows were customer-facing,
    -- so they default to 'display'; amount is NULL for them and falls back to
    -- quantity * unit_price when rendering.
    ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS kind   TEXT NOT NULL DEFAULT 'display';
    ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS amount DOUBLE PRECISION;
    -- Per-line markup applied to a display line's amount, stored as a fraction
    -- (0.15 = 15%). Folded into the printed line price on the customer PDF, so it
    -- raises the total without showing as its own line. Replaces the old
    -- quote-level markup_rate/tax_rate for customer-facing math.
    ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS markup_rate DOUBLE PRECISION NOT NULL DEFAULT 0;
    -- Cost category for internal 'pricing' worksheet rows (Subcontractor,
    -- Material, Equipment Rentals, Travel, Project Management). NULL for
    -- display rows and older worksheet rows created before the field existed.
    ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS cost_type TEXT;
    -- Name of the pricing option a customer-facing line belongs to. Option lines
    -- are 'alternate' rows grouped by this name: each option is totalled on its
    -- own and never summed into the base Total. For rows written from here on the
    -- invariant is kind='alternate' <=> option_group IS NOT NULL; an 'alternate'
    -- row with a NULL option_group is a legacy single-line option (imported
    -- before options had line items) and stands alone as its own option.
    ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS option_group TEXT;

    CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
    CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_line_items(quote_id);
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
    CREATE INDEX IF NOT EXISTS idx_time_project ON time_entries(project_id);
    CREATE INDEX IF NOT EXISTS idx_time_user ON time_entries(user_id);
    CREATE INDEX IF NOT EXISTS idx_files_project ON project_files(project_id);
    CREATE INDEX IF NOT EXISTS idx_quote_files_quote ON quote_files(quote_id);
    CREATE INDEX IF NOT EXISTS idx_breaks_entry ON time_breaks(time_entry_id);

    /* ==================================================================
     * Email settings + automated notifications
     *
     * Design:
     *  - Sender identity lives in ONE singleton row (email_settings, id=1).
     *  - WHO receives each email type is per-user boolean columns on users.
     *  - Transport is an HTTP email API keyed by an env-var secret
     *    (SENDGRID_API_KEY) — never stored in the DB. The legacy smtp_*
     *    columns below are kept nullable/unused for backwards-compat only.
     *  - Timing for scheduled emails is env-var + cron driven, not the DB.
     *  - Singleton "run lock" tables debounce duplicate sends across workers.
     * ================================================================== */

    /* ==================================================================
     * Company profile shown on customer-facing quote PDFs.
     *
     * Singleton row (id = 1) so the quote header/footer render the same
     * everywhere. Seeded with the previous hard-coded defaults so existing
     * installs look identical until an admin edits the values under
     * Settings -> Company.
     * ================================================================== */
    CREATE TABLE IF NOT EXISTS company_settings (
      id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      name       TEXT NOT NULL DEFAULT '',
      address    TEXT NOT NULL DEFAULT '',  -- newline-separated address lines
      phone      TEXT NOT NULL DEFAULT '',
      email      TEXT NOT NULL DEFAULT '',
      website    TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Default Terms & Conditions pre-filled on every new quote, editable under
    -- Settings -> Company. Kept here (alongside the other quote-document defaults)
    -- so one singleton row drives what appears on customer-facing quotes.
    ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS default_terms TEXT NOT NULL DEFAULT '';
    INSERT INTO company_settings (id, name, address, phone, email, website)
    VALUES (
      1,
      'Cornerstone Facility Solutions',
      '123 Main Street
Suite 100
Your City, ST 00000',
      '(555) 555-0100',
      'estimating@cornerstonefs.com',
      'cornerstonefs.com'
    )
    ON CONFLICT (id) DO NOTHING;

    -- Singleton sender-identity row. CHECK (id = 1) enforces exactly one row.
    CREATE TABLE IF NOT EXISTS email_settings (
      id            INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      from_name     TEXT NOT NULL DEFAULT '',
      from_email    TEXT NOT NULL DEFAULT '',
      -- Legacy SMTP columns: retained but NOT used for delivery (HTTP API only).
      smtp_host     TEXT,
      smtp_port     INTEGER,
      smtp_user     TEXT,
      smtp_password TEXT,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO email_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

    -- Per-user subscription flags: one boolean column per subscribable email
    -- type. Both flags now drive a once-a-day DIGEST rather than a per-event
    -- email (see email_digest_events below):
    --   receives_new_project_emails -> the day's sold work
    --   receives_completion_emails  -> the day's completed jobs
    ALTER TABLE users ADD COLUMN IF NOT EXISTS receives_new_project_emails BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS receives_completion_emails  BOOLEAN NOT NULL DEFAULT false;

    -- Migrate installs created before the email types were reworked: carry the
    -- old "completion report" subscribers onto the new-project flag, then drop
    -- the retired columns. Guarded so it's safe to run repeatedly.
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'users' AND column_name = 'receives_completion_report') THEN
        UPDATE users SET receives_new_project_emails = receives_completion_report;
        ALTER TABLE users DROP COLUMN receives_completion_report;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'users' AND column_name = 'receives_project_reminders') THEN
        ALTER TABLE users DROP COLUMN receives_project_reminders;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'users' AND column_name = 'receives_schedule_change_emails') THEN
        ALTER TABLE users DROP COLUMN receives_schedule_change_emails;
      END IF;
    END $$;

    -- Ordered email-resolution chain: personal_email -> work_email -> email.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS personal_email TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS work_email     TEXT;

    -- Outbox for the two daily digests. Marking a quote sold or a job complete
    -- no longer emails anybody on the spot: it drops a row here, and the daily
    -- digest scheduler collects every unsent row of a kind, sends ONE email
    -- listing them, and stamps sent_at. Queueing rather than querying by
    -- timestamp is what makes the digest exact — projects.updated_at moves on
    -- any edit, so it can't tell what actually happened today, and a server that
    -- was down at send time still reports the backlog on its next run.
    CREATE TABLE IF NOT EXISTS email_digest_events (
      id         SERIAL PRIMARY KEY,
      kind       TEXT NOT NULL CHECK (kind IN ('new_project','job_completed')),
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_at    TIMESTAMPTZ
    );
    -- One pending row per job per kind: a job completed, reopened and completed
    -- again before the digest runs is still one line in it. The index is partial
    -- so the same job can appear in a later digest once this one has gone out.
    CREATE UNIQUE INDEX IF NOT EXISTS email_digest_events_pending_uniq
      ON email_digest_events (kind, project_id) WHERE sent_at IS NULL;
    CREATE INDEX IF NOT EXISTS email_digest_events_pending_idx
      ON email_digest_events (kind, created_at) WHERE sent_at IS NULL;

    -- Retired with the scheduled/schedule-change emails: the per-job run locks
    -- and the schedule-change snapshot table are no longer used.
    DROP TABLE IF EXISTS project_reminder_run_lock;
    DROP TABLE IF EXISTS completion_report_run_lock;
    DROP TABLE IF EXISTS schedule_change_notifications;
  `);

  // ---- Incremental migrations (safe to run repeatedly) ------------------
  // The role set is admin / manager / employee. The CHECK constraint above lives
  // inside CREATE TABLE IF NOT EXISTS, so existing databases never pick up
  // changes to it — rebuild the constraint idempotently instead.
  //
  // The retired 'worker' role folded into 'employee' (time clock plus their own
  // schedule): the rows are rewritten BEFORE the narrower constraint goes on, so
  // the migration can't fail on data it is about to fix. The default is reset
  // too, since existing installs still carry DEFAULT 'worker'.
  await pool.query(`
    UPDATE users SET role = 'employee' WHERE role = 'worker';
    ALTER TABLE users ALTER COLUMN role SET DEFAULT 'employee';
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('admin','manager','employee'));
  `);

  // Crew can now clock in without picking a specific job, and admins can
  // mark each shift as paid, so time_entries needs a nullable project and a
  // few payroll columns.
  await pool.query(`
    ALTER TABLE time_entries ALTER COLUMN project_id DROP NOT NULL;
    ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
    ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS paid_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    -- Payroll check number recorded when an admin marks a week paid.
    ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS check_number TEXT;
  `);

  // Per-user hourly pay rate for the weekly check calculation on Timesheets.
  // NULL = no rate set. Visible/editable only by admins and managers.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate DOUBLE PRECISION;
  `);

  // Reporting hierarchy: each user can be assigned a manager (another user),
  // used to route weekly time-approval work up the chain. NULL = reports to
  // no one. ON DELETE SET NULL so removing a manager orphans (rather than
  // blocks or cascades) their reports.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
  `);

  // Who the crew week offers to book. Someone can be an active user of the
  // tracker without ever being scheduled onto a job — an office manager, an
  // estimator, anyone who clocks in but isn't crew — so scheduling is its own
  // flag rather than a role. TRUE for everybody who existed before it, which
  // is the behaviour they already had. Turning it off hides them from the crew
  // week; days they were already booked on are left alone.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS schedulable BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  /* ==================================================================
   * Invoicing.
   *
   * A project is billed with one or more invoices, each with its own amount
   * and two independent flags: whether it has been sent to the customer
   * (billed) and whether the money has landed (paid). This replaces the old
   * free-text projects.invoice_numbers field, which is kept (unused by the UI)
   * so the one-time backfill below stays re-runnable and nothing is lost.
   * ================================================================== */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_invoices (
      id             SERIAL PRIMARY KEY,
      project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      invoice_number TEXT,
      amount         DOUBLE PRECISION NOT NULL DEFAULT 0,
      billed         BOOLEAN NOT NULL DEFAULT FALSE,
      paid           BOOLEAN NOT NULL DEFAULT FALSE,
      position       INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_project_invoices_project ON project_invoices(project_id);
  `);

  // One-time backfill: split the legacy comma-separated invoice_numbers into
  // one row per invoice (amount unknown, so 0). The settings marker makes this
  // run exactly once, so invoices edited afterwards are never re-created.
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM settings WHERE key = 'invoices_backfilled_v1') THEN
        INSERT INTO project_invoices (project_id, invoice_number, position)
        SELECT p.id, btrim(t.part), t.ord
          FROM projects p
          CROSS JOIN LATERAL unnest(string_to_array(p.invoice_numbers, ',')) WITH ORDINALITY AS t(part, ord)
         WHERE p.invoice_numbers IS NOT NULL AND btrim(t.part) <> '';
        INSERT INTO settings (key, value) VALUES ('invoices_backfilled_v1', '1')
        ON CONFLICT (key) DO NOTHING;
      END IF;
    END $$;
  `);

  /* ------------------------------------------------------------------
   * What an invoice needs beyond a number and an amount: the customer's
   * purchase-order number it bills against, the date it actually went out,
   * and the PDF that was sent.
   *
   * `sent_on` does not replace `billed` — `billed` is what the pipeline reads
   * and it stays the flag. The date is the paperwork answer to "when did this
   * go out", kept in step with the flag by the invoice card and the action
   * behind it (a date implies sent; clearing sent clears the date). Invoices
   * billed before the column existed keep a NULL date rather than a guessed
   * one — an invented send date is worse than an unknown one.
   * ------------------------------------------------------------------ */
  await pool.query(`
    ALTER TABLE project_invoices ADD COLUMN IF NOT EXISTS po_number TEXT;
    ALTER TABLE project_invoices ADD COLUMN IF NOT EXISTS sent_on   DATE;
  `);

  /* ------------------------------------------------------------------
   * The invoice PDF: one per invoice, so the row is keyed by the invoice
   * itself and a re-upload replaces what was there. The bytes are stored
   * inline as a base64 data URL, exactly like project_files.
   *
   * It is deliberately NOT a project_files row: an invoice is A/R paperwork
   * and only the billing roles may read it, which is the gate on
   * /api/invoices/[id]/pdf. The Files tab is a wider audience than the
   * Billing tab, and this way it stays that way.
   * ------------------------------------------------------------------ */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoice_files (
      invoice_id    INTEGER PRIMARY KEY REFERENCES project_invoices(id) ON DELETE CASCADE,
      filename      TEXT NOT NULL,
      mime          TEXT,
      size          INTEGER NOT NULL DEFAULT 0,
      data          TEXT NOT NULL,
      uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      uploader_name TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  /* ==================================================================
   * Billing workflow.
   *
   * Where a job stands between "the work is finished" and "the money is in".
   * The stage itself is DERIVED from the project's status and its invoice rows
   * (see src/lib/billing.ts) — only the three things the invoices can't say
   * are stored here:
   *
   *   completed_at        — when the job hit the billing desk. `end_date` is
   *                         a date somebody typed for the work; this is
   *                         stamped by the status change, so the queue can
   *                         age jobs honestly. Cleared if a job is reopened.
   *   billing_hold(+reason) — billing deliberately parked (dispute,
   *                         retainage, waiting on paperwork), so a job that
   *                         shouldn't be chased stops being counted late.
   *   billing_closed_at/by — signed off the billing desk. A close-out is a
   *                         human act: a fully paid job still wants a final
   *                         look, and a no-charge job closes with nothing
   *                         raised at all.
   * ================================================================== */
  await pool.query(`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS completed_at         TIMESTAMPTZ;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS billing_hold         BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS billing_hold_reason  TEXT;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS billing_closed_at    TIMESTAMPTZ;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS billing_closed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_projects_completed_at ON projects(completed_at);
  `);

  // Backfill: jobs already marked complete before the column existed. Their
  // best available completion date is the end date entered for the work, and
  // failing that when the row was last touched. Self-guarding rather than
  // marker-guarded — a completed job with no stamp always wants one, and the
  // stamp is only ever written by a status change afterwards.
  await pool.query(`
    UPDATE projects
       SET completed_at = COALESCE(end_date::timestamptz, updated_at)
     WHERE status = 'completed' AND completed_at IS NULL;
  `);

  /* ==================================================================
   * Jobs parked while somebody else finishes their part.
   *
   * A job on hold is still live work: its status stays not started or in
   * progress, its phases stay on the schedule, and its dates stay where they
   * are. What the flag says is that nothing is waiting on US — the general
   * contractor hasn't poured the slab, the owner hasn't picked a colour, the
   * other trade isn't out of the room yet.
   *
   *   on_hold(+reason)  — parked, with what it is waiting on. The reason is
   *                       required: the whole point of a hold is that the next
   *                       person to look at the board knows who to chase.
   *   on_hold_since     — when it was parked, so a hold that has been sitting
   *                       for a month reads as one.
   * ================================================================== */
  await pool.query(`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS on_hold        BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS on_hold_reason TEXT;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS on_hold_since  TIMESTAMPTZ;
  `);

  /* ==================================================================
   * Self-service password reset.
   *
   * A user who forgets their password requests a reset from the login
   * screen; we email them a single-use, time-limited link. Only the SHA-256
   * HASH of the token is stored here — the raw token lives only in the email
   * link — so a leaked table can't be used to reset anyone's password.
   * Rows are consumed on use (used_at) and are safe to prune after expiry.
   * ================================================================== */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_pw_reset_user ON password_reset_tokens(user_id);
  `);

  /* ==================================================================
   * Weekly time approval.
   *
   * Every employee reports to a manager (users.manager_id). Each Monday the
   * manager gets an email summarizing every direct report's prior week and a
   * tokenized link to approve those hours without logging in. Approvals are
   * one row per (employee, Monday-start week); the raw token only ever lives
   * in the emailed link — the table stores its SHA-256 hash, like the
   * password-reset flow. Tokens are MULTI-USE until expiry so a manager can
   * approve reports one at a time from the same email.
   * ================================================================== */
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    CREATE TABLE IF NOT EXISTS time_week_approvals (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_start DATE NOT NULL,
      approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      via TEXT NOT NULL DEFAULT 'app' CHECK (via IN ('app','email')),
      PRIMARY KEY (user_id, week_start)
    );
    CREATE TABLE IF NOT EXISTS time_approval_tokens (
      token_hash TEXT PRIMARY KEY,
      manager_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_start DATE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  /* ==================================================================
   * Saved catalogs, editable under Settings:
   *   - customers            : reusable customer records (address, contact
   *                            details) that feed the New Quote customer picker.
   *   - customer_contacts    : named people at a customer, each with their own
   *                            email + phone; selecting one on a quote fills the
   *                            contact fields.
   *   - pricing_items        : a price book of line items with a default unit
   *                            and unit price, droppable into the quote pricing
   *                            worksheet.
   * All three are safe to create repeatedly (IF NOT EXISTS).
   * ================================================================== */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      address    TEXT,
      phone      TEXT,
      email      TEXT,
      notes      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- One record per customer name (case-insensitive) so the picker stays clean.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_name ON customers(lower(name));

    -- Three-letter customer code that prefixes auto-generated quote numbers
    -- (XXXMMDDYY). Added later, so ADD COLUMN IF NOT EXISTS keeps this safe to
    -- re-run against an existing database.
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS abbreviation TEXT;
    -- Unique across customers (case-insensitive) so a code always identifies one
    -- customer. Existing rows have none yet, so NULLs are exempt.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_abbreviation
      ON customers(upper(abbreviation)) WHERE abbreviation IS NOT NULL;

    CREATE TABLE IF NOT EXISTS customer_contacts (
      id          SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      title       TEXT,
      email       TEXT,
      phone       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_customer ON customer_contacts(customer_id);

    CREATE TABLE IF NOT EXISTS pricing_items (
      id          SERIAL PRIMARY KEY,
      description TEXT NOT NULL,
      unit        TEXT,
      unit_price  DOUBLE PRECISION NOT NULL DEFAULT 0,
      category    TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Units of measure shared by the pricing worksheet and the price book. New
    -- units can be added from the quote view or the pricing list, so they live
    -- in a table (rather than a hard-coded array) and are shared everywhere.
    CREATE TABLE IF NOT EXISTS units (
      id         SERIAL PRIMARY KEY,
      label      TEXT NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_units_label ON units(lower(label));

    -- Quote/work categories (Flooring, Painting, …). Editable from the quote
    -- builder ("+ Add new category…"), so like units they live in a table
    -- rather than a hard-coded array.
    CREATE TABLE IF NOT EXISTS categories (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name ON categories(lower(name));
  `);

  // Seed the default units once, on an empty table. ON CONFLICT keeps this safe
  // to run repeatedly and against installs where an admin has edited the list.
  await pool.query(
    `INSERT INTO units (label, position)
     VALUES ('ea',1),('sf',2),('lf',3),('sy',4),('hr',5),('day',6),('ls',7),('gal',8)
     ON CONFLICT (lower(label)) DO NOTHING`
  );

  // Seed the default categories (previously a hard-coded list in the quote
  // builder), then backfill any custom category names already stored on quotes
  // or price-book items so they stay selectable in the new dropdown.
  await pool.query(
    `INSERT INTO categories (name, position)
     VALUES ('Flooring',1),('Painting',2),('Renovation',3),('Roofing',4),
            ('Restoration',5),('Maintenance',6),('Janitorial',7),('Grounds',8)
     ON CONFLICT (lower(name)) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO categories (name, position)
     SELECT DISTINCT btrim(category), 100
       FROM (SELECT category FROM quotes
             UNION ALL
             SELECT category FROM pricing_items) src
      WHERE category IS NOT NULL AND btrim(category) <> ''
     ON CONFLICT (lower(name)) DO NOTHING`
  );

  /* ==================================================================
   * Job scheduling.
   *
   * A job is planned as an ordered set of phases (schedule_tasks). Each
   * phase carries an EARLIEST start plus a duration in working days, and
   * may follow another phase (depends_on_id + lag_days). Real start/end
   * dates are never stored — they're derived from the dependency chain by
   * src/lib/schedule-math.ts, so pushing one phase out automatically
   * shifts everything downstream and nothing can go stale.
   *
   * People and subs are attached to a phase via schedule_assignments;
   * schedule_holidays removes days from the working-day math.
   * ================================================================== */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subcontractors (
      id           SERIAL PRIMARY KEY,
      name         TEXT NOT NULL,
      trade        TEXT,
      contact_name TEXT,
      phone        TEXT,
      email        TEXT,
      notes        TEXT,
      active       BOOLEAN NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- One record per sub name (case-insensitive) so the picker stays clean.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subs_name ON subcontractors(lower(name));

    CREATE TABLE IF NOT EXISTS schedule_tasks (
      id            SERIAL PRIMARY KEY,
      project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      -- Earliest start. With no predecessor this IS the start; with one, the
      -- computed start is max(this, predecessor end + lag + 1 working day).
      start_date    DATE NOT NULL,
      duration_days INTEGER NOT NULL DEFAULT 1 CHECK (duration_days >= 1),
      depends_on_id INTEGER REFERENCES schedule_tasks(id) ON DELETE SET NULL,
      lag_days      INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'not_started'
                    CHECK (status IN ('not_started','in_progress','complete')),
      notes         TEXT,
      position      INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_sched_tasks_project ON schedule_tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_sched_tasks_depends ON schedule_tasks(depends_on_id);

    -- SUPERSEDED by schedule_crew_days (see migrateCrewDays below): crew is
    -- now booked a day at a time from the crew week, not a whole window at a
    -- time from the timeline. Kept, and never written to again, so the
    -- pre-redesign bookings survive and the backfill can be re-run against a
    -- restored backup.
    CREATE TABLE IF NOT EXISTS schedule_assignments (
      id               SERIAL PRIMARY KEY,
      task_id          INTEGER NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
      user_id          INTEGER REFERENCES users(id) ON DELETE CASCADE,
      subcontractor_id INTEGER REFERENCES subcontractors(id) ON DELETE CASCADE,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK ((user_id IS NULL) <> (subcontractor_id IS NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_sched_assign_task ON schedule_assignments(task_id);
    CREATE INDEX IF NOT EXISTS idx_sched_assign_user ON schedule_assignments(user_id);
    CREATE INDEX IF NOT EXISTS idx_sched_assign_sub  ON schedule_assignments(subcontractor_id);

    -- Non-working days excluded from duration math (holidays, shutdowns).
    CREATE TABLE IF NOT EXISTS schedule_holidays (
      day        DATE PRIMARY KEY,
      label      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  /* ==================================================================
   * Split days: which days of the week an assignee actually works a phase.
   *
   * work_days is a 7-bit mask indexed by JavaScript's getDay() (bit 0 =
   * Sunday … bit 6 = Saturday). NULL means "every working day in the
   * phase's window" — the original behaviour, and still the default — so
   * existing rows need no backfill. A mask lets one employee run a job
   * Mon/Wed while working somewhere else Tuesday: the phase window is
   * unchanged, but that person is only booked on their own days, and the
   * double-booking check compares days rather than whole windows.
   * ================================================================== */
  await pool.query(`
    ALTER TABLE schedule_assignments ADD COLUMN IF NOT EXISTS work_days SMALLINT;
    ALTER TABLE schedule_assignments DROP CONSTRAINT IF EXISTS schedule_assignments_work_days_check;
    ALTER TABLE schedule_assignments ADD CONSTRAINT schedule_assignments_work_days_check
      CHECK (work_days IS NULL OR (work_days > 0 AND work_days <= 127));
  `);

  /* ==================================================================
   * Overlapping phases.
   *
   * A phase used to be able to follow another only after it finished.
   * depends_type adds a start-to-start link, so a sub can start a set
   * number of working days after the phase before it STARTS and the two
   * run alongside each other. lag_days is read against whichever anchor
   * depends_type names.
   * ================================================================== */
  await pool.query(`
    ALTER TABLE schedule_tasks ADD COLUMN IF NOT EXISTS depends_type TEXT
      NOT NULL DEFAULT 'finish_to_start';
    ALTER TABLE schedule_tasks DROP CONSTRAINT IF EXISTS schedule_tasks_depends_type_check;
    ALTER TABLE schedule_tasks ADD CONSTRAINT schedule_tasks_depends_type_check
      CHECK (depends_type IN ('finish_to_start','start_to_start'));
  `);

  /* ==================================================================
   * Publishing a job's schedule, and the reasons it changed afterwards.
   *
   * Publishing marks the moment a job's dates went out to the crew. From
   * then on every change to that job's phases (dates, duration, links,
   * crew, adding or deleting a phase) has to carry a typed reason, which
   * is recorded here with an auto-generated summary of what actually
   * moved. schedule_changes.task_name is copied rather than joined so the
   * history survives the phase being deleted.
   * ================================================================== */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_publications (
      id           SERIAL PRIMARY KEY,
      project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version      INTEGER NOT NULL,
      note         TEXT,
      published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      published_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sched_pub_project_version
      ON schedule_publications(project_id, version);

    CREATE TABLE IF NOT EXISTS schedule_changes (
      id         SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id    INTEGER REFERENCES schedule_tasks(id) ON DELETE SET NULL,
      task_name  TEXT,
      kind       TEXT NOT NULL CHECK (kind IN ('added','updated','deleted')),
      summary    TEXT NOT NULL,
      reason     TEXT NOT NULL,
      version    INTEGER,
      changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_sched_changes_project ON schedule_changes(project_id, created_at DESC);

    -- Jobs whose schedule has been edited since it was last published, i.e.
    -- whose crew has not been told the dates that are now on the board. One
    -- row per job, written by every schedule edit and deleted when the job is
    -- published, so the schedule's Publish button knows what is outstanding
    -- without having to guess from timestamps (a booking that was taken off
    -- again leaves nothing behind to compare).
    CREATE TABLE IF NOT EXISTS schedule_draft_state (
      project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  /* ==================================================================
   * Job-site details the crew needs, and a date that can't move.
   *
   * site_address is the address crews drive to — kept apart from
   * `location` (a short "City, ST" label used on quotes and lists) so the
   * schedule can show a full, mappable address without changing how jobs
   * read everywhere else.
   *
   * hard_finish_date is a commitment: the job MUST be done by then. It's
   * separate from due_date (the target) so the schedule can warn louder
   * when derived work runs past the date that isn't negotiable.
   * ================================================================== */
  await pool.query(`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS site_address     TEXT;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS hard_finish_date DATE;
  `);

  /* ==================================================================
   * Daily start times.
   *
   * schedule_tasks.start_time is the time the crew starts each day of a
   * phase, as 'HH:MM' text — no timezone, the same way dates are plain
   * 'YYYY-MM-DD' here. NULL means no time was set and the crew works
   * their normal hours.
   *
   * schedule_task_day_times overrides that for one specific day, for the
   * morning a crew has to be on site at 6 for a delivery. A row whose
   * start_time is NULL means "no time set on this day" and overrides the
   * phase default with nothing, which is how a single day is exempted.
   * ================================================================== */
  await pool.query(`
    ALTER TABLE schedule_tasks ADD COLUMN IF NOT EXISTS start_time TEXT;
    ALTER TABLE schedule_tasks DROP CONSTRAINT IF EXISTS schedule_tasks_start_time_check;
    ALTER TABLE schedule_tasks ADD CONSTRAINT schedule_tasks_start_time_check
      CHECK (start_time IS NULL OR start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

    CREATE TABLE IF NOT EXISTS schedule_task_day_times (
      id         SERIAL PRIMARY KEY,
      task_id    INTEGER NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
      day        DATE NOT NULL,
      start_time TEXT CHECK (start_time IS NULL OR start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sched_day_times_task_day
      ON schedule_task_day_times(task_id, day);
  `);

  /* ==================================================================
   * Crew notes: job-specific messages to the people working it.
   *
   * Separate from the `notes` table (internal job notes) because these are
   * written to be read by the crew — they show up on every assignee's own
   * schedule and in the schedule email. Pinned notes stay at the top of
   * the list however old they are.
   * ================================================================== */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crew_notes (
      id          SERIAL PRIMARY KEY,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      body        TEXT NOT NULL,
      pinned      BOOLEAN NOT NULL DEFAULT FALSE,
      author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_crew_notes_project
      ON crew_notes(project_id, pinned DESC, created_at DESC);
  `);

  /* ==================================================================
   * Change reasons are no longer only for published schedules.
   *
   * Moving a phase's dates, its duration, its link to another phase or a
   * job's hard finish date now always carries a reason, published or not,
   * so a job's history answers "what moved, and why" from the first plan
   * onwards. Rows logged before a publish have a NULL version, and
   * task_id is NULL for a change to the job itself rather than a phase.
   * ================================================================== */
  await pool.query(`
    ALTER TABLE schedule_changes ALTER COLUMN version DROP NOT NULL;
    ALTER TABLE schedule_changes DROP CONSTRAINT IF EXISTS schedule_changes_kind_check;
    ALTER TABLE schedule_changes ADD CONSTRAINT schedule_changes_kind_check
      CHECK (kind IN ('added','updated','deleted','job'));
  `);

  /* ==================================================================
   * Shift lengths: a job books for ALL DAY unless told otherwise.
   *
   * schedule_tasks.hours is how long the crew is on the job each day,
   * paired with start_time to make a bounded shift. NULL — the default,
   * and what every existing phase keeps — means all day: most work takes
   * the day it takes, and only a job deliberately split with another
   * needs a length put on it.
   *
   * schedule_task_day_times.hours does the same for one day, so a row
   * there is the whole day's shift (start time AND length) rather than
   * just its time. That pairing is what lets one person be booked at two
   * places on one day — 8:00 for 4 hours here, noon for 4 hours there —
   * without the two reading as a double-booking.
   *
   * Bounded above by 24 rather than by a working day: a 12-hour shutdown
   * shift is real work, and nothing here should have an opinion about
   * how long a day is allowed to be.
   * ================================================================== */
  await pool.query(`
    ALTER TABLE schedule_tasks ADD COLUMN IF NOT EXISTS hours DOUBLE PRECISION;
    ALTER TABLE schedule_tasks DROP CONSTRAINT IF EXISTS schedule_tasks_hours_check;
    ALTER TABLE schedule_tasks ADD CONSTRAINT schedule_tasks_hours_check
      CHECK (hours IS NULL OR (hours > 0 AND hours <= 24));

    ALTER TABLE schedule_task_day_times ADD COLUMN IF NOT EXISTS hours DOUBLE PRECISION;
    ALTER TABLE schedule_task_day_times DROP CONSTRAINT IF EXISTS schedule_task_day_times_hours_check;
    ALTER TABLE schedule_task_day_times ADD CONSTRAINT schedule_task_day_times_hours_check
      CHECK (hours IS NULL OR (hours > 0 AND hours <= 24));
  `);

  /* ==================================================================
   * Change orders — why a sold job is no longer worth what we sold it
   * for.
   *
   * projects.value is the contract value, and it moves: extra scope, a
   * deleted line, a negotiated credit. It used to move as a bare text
   * box in the Edit Project modal, which meant a job could be worth
   * five thousand more than yesterday with nothing anywhere saying so.
   * The billing desk has always flagged a job invoiced over its
   * contract as "worth checking against a change order" — this is the
   * table that check finally has something to read.
   *
   * Append-only, and the reason is NOT NULL for the same reason a
   * schedule change's is: a bare "the value changed" is unreadable a
   * fortnight later, and "added roof curb flashing per the owner's
   * walkthrough" tells the next person what they are looking at. The
   * value itself stays on projects — this is the history of it, not the
   * source of it, so every existing reader of projects.value is
   * untouched.
   *
   * changed_by goes NULL rather than cascading: the history outlives
   * the person who typed it.
   * ================================================================== */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_value_changes (
      id         SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      old_value  DOUBLE PRECISION NOT NULL,
      new_value  DOUBLE PRECISION NOT NULL,
      -- The customer-facing change order this answers to, when there is one.
      -- Optional: plenty of adjustments are agreed before the paperwork is.
      co_number  TEXT,
      reason     TEXT NOT NULL,
      changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_project_value_changes_project
      ON project_value_changes(project_id, created_at DESC);
  `);

  await migrateCrewDays(pool);
  await migrateSubcontractedPhases(pool);
  await migrateWarehouseDays(pool);
  await migrateReceipts(pool);
}

/* ====================================================================
 * Warehouse days — the standing card.
 *
 * Not every day of work is a job. Somebody has to be in the warehouse:
 * loading out, taking a delivery, putting stock away, cleaning up after
 * a job that has gone. That work has no customer, no phases, no budget
 * and no end date, so it is not a project and never was — a project
 * invented to hold it would land on the billing desk and in the
 * dashboard's counts, which is the opposite of what it is.
 *
 * Hence its own table, and its own card in the crew week: one row per
 * person per day in the warehouse, always available, never full. The
 * crew week draws it as a card that is always there rather than one
 * filed under the week some phase starts in, because there is no week
 * it belongs to more than another.
 * ==================================================================== */
async function migrateWarehouseDays(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS warehouse_days (
      id         SERIAL PRIMARY KEY,
      day        DATE NOT NULL,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- One person, one day: booking somebody who is already in that day is a
    -- click that landed twice, not a second day of work.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_days_person
      ON warehouse_days(day, user_id);
    CREATE INDEX IF NOT EXISTS idx_warehouse_days_user ON warehouse_days(user_id, day);
  `);
}

/* ====================================================================
 * Crew planning, then crew staffing.
 *
 * The timeline plans WORK: a phase says how long it runs and how many
 * people it needs (crew_size). It no longer names anybody — picking
 * particular employees while looking at a Gantt chart meant guessing at
 * a week you couldn't see.
 *
 * The crew week STAFFS that work: schedule_crew_days is one row per
 * person per day on a phase, so a manager fills the phase's budget of
 * crew_size x working days however the week actually falls — four people
 * Monday, one on Friday. A phase's remaining budget is what stops it
 * being over-staffed, and two rows for one person on one day across two
 * jobs is what a double-booking now is.
 * ==================================================================== */
async function migrateCrewDays(pool: Pool) {
  await pool.query(`
    -- The bound on crew_size is asserted once, by migrateSubcontractedPhases
    -- below. These blocks all re-run on every boot, so two of them declaring
    -- the same constraint means the stricter one fails against rows the looser
    -- one allows — which is exactly what a subcontracted phase needing none of
    -- our crew is.
    ALTER TABLE schedule_tasks ADD COLUMN IF NOT EXISTS crew_size INTEGER NOT NULL DEFAULT 1;

    -- One person, one day, one phase. Exactly one of user_id /
    -- subcontractor_id, the same shape schedule_assignments used.
    CREATE TABLE IF NOT EXISTS schedule_crew_days (
      id               SERIAL PRIMARY KEY,
      task_id          INTEGER NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
      day              DATE NOT NULL,
      user_id          INTEGER REFERENCES users(id) ON DELETE CASCADE,
      subcontractor_id INTEGER REFERENCES subcontractors(id) ON DELETE CASCADE,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK ((user_id IS NULL) <> (subcontractor_id IS NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_crew_days_task ON schedule_crew_days(task_id, day);
    CREATE INDEX IF NOT EXISTS idx_crew_days_day  ON schedule_crew_days(day);
    -- Partial uniques rather than one composite: a NULL column never
    -- collides in a plain unique index, so a person could be added twice.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_crew_days_user
      ON schedule_crew_days(task_id, day, user_id) WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_crew_days_sub
      ON schedule_crew_days(task_id, day, subcontractor_id) WHERE subcontractor_id IS NOT NULL;
  `);

  await backfillCrewDays(pool);
}

/* ====================================================================
 * Subcontracted phases.
 *
 * Not every phase is staffed out of our own crew. When a phase is a
 * subcontractor's work, the sub is chosen up front on the timeline — that
 * is when the work is contracted — rather than booked a day at a time,
 * and their days on site follow the phase's dates automatically. Hence a
 * column on the phase rather than crew-day rows: there is nothing to
 * decide week by week, and a sub whose phase slips should move with it.
 *
 * crew_size drops to a minimum of 0 to go with it, so a phase can say
 * "the sub covers this, no Cornerstone crew needed" — or carry a headcount
 * alongside the sub, for the supervisor we still send.
 * ==================================================================== */
async function migrateSubcontractedPhases(pool: Pool) {
  await pool.query(`
    ALTER TABLE schedule_tasks ADD COLUMN IF NOT EXISTS subcontractor_id INTEGER
      REFERENCES subcontractors(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_sched_tasks_sub ON schedule_tasks(subcontractor_id);

    ALTER TABLE schedule_tasks DROP CONSTRAINT IF EXISTS schedule_tasks_crew_size_check;
    ALTER TABLE schedule_tasks ADD CONSTRAINT schedule_tasks_crew_size_check
      CHECK (crew_size >= 0);
  `);
}

/**
 * Carry the old whole-window assignments over to per-day staffing, once.
 *
 * schedule_assignments held a person plus an optional weekday mask, which only
 * means real days once the dependency solver has resolved the phase's window —
 * so this runs the same solver the app does rather than trying to express it in
 * SQL. Each person's masked working days become crew-day rows, and the phase's
 * crew_size becomes the most people it ever had on one day, which is the
 * headcount that plan was really asking for.
 *
 * schedule_assignments itself is left alone: it's the record of who was booked
 * before the redesign, and keeping it means this can be re-run against a
 * restored backup.
 */
async function backfillCrewDays(pool: Pool) {
  const done = await pool.query(
    `SELECT 1 FROM settings WHERE key = 'schedule_crew_days_backfilled'`
  );
  if (done.rowCount) return;

  const { rows: tasks } = await pool.query<{
    id: number;
    project_id: number;
    start_date: string;
    duration_days: number;
    depends_on_id: number | null;
    depends_type: DependsType;
    lag_days: number;
  }>(
    `SELECT id, project_id, start_date, duration_days, depends_on_id, depends_type, lag_days
       FROM schedule_tasks`
  );

  if (tasks.length > 0) {
    const [{ rows: assignments }, { rows: holidays }] = await Promise.all([
      pool.query<{
        task_id: number;
        user_id: number | null;
        subcontractor_id: number | null;
        work_days: number | null;
      }>('SELECT task_id, user_id, subcontractor_id, work_days FROM schedule_assignments'),
      pool.query<{ day: string }>('SELECT day FROM schedule_holidays'),
    ]);

    const calendar = { holidays: new Set(holidays.map((h) => h.day)) };
    const { windows } = computeSchedule(tasks, calendar);

    const byTask = new Map<number, typeof assignments>();
    for (const a of assignments) {
      const list = byTask.get(a.task_id);
      if (list) list.push(a);
      else byTask.set(a.task_id, [a]);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const task of tasks) {
        const window = windows.get(task.id);
        const crew = byTask.get(task.id) ?? [];
        if (!window || crew.length === 0) continue;

        // How many of them land on each day — the busiest day is the headcount.
        const perDay = new Map<string, number>();
        for (const a of crew) {
          for (const day of eachDay(window.start, window.end)) {
            if (!worksLegacyDay(day, a.work_days, calendar)) continue;
            perDay.set(day, (perDay.get(day) ?? 0) + 1);
            await client.query(
              `INSERT INTO schedule_crew_days (task_id, day, user_id, subcontractor_id)
               VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
              [task.id, day, a.user_id, a.subcontractor_id]
            );
          }
        }
        const size = Math.max(1, ...perDay.values());
        await client.query('UPDATE schedule_tasks SET crew_size = $1 WHERE id = $2', [
          size,
          task.id,
        ]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('schedule_crew_days_backfilled', 'done')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
  );
}

/**
 * Did a pre-redesign assignee work this day? Their `work_days` was a 7-bit
 * day-of-week mask (bit 0 = Sunday … bit 6 = Saturday) narrowing the phase's
 * working days, with NULL meaning all of them. The concept lives only here now,
 * for reading those old rows.
 */
function worksLegacyDay(
  day: string,
  mask: number | null,
  cal: { holidays: Set<string> }
): boolean {
  if (!isWorkingDay(day, cal)) return false;
  return mask == null || (mask & (1 << new Date(day + 'T00:00:00').getDay())) !== 0;
}

/* ====================================================================
 * Job receipts — what a job COST.
 *
 * A job has always known what it was sold for. What it cost to do was
 * paper in somebody's truck: a materials run to the supply house, a tank
 * of fuel, a blade that snapped. The Files tab could hold a photo of the
 * receipt, but a project_files row is a filename — it cannot say who the
 * receipt is from, what day it is from, or what it came to, so a job's
 * spend could be attached but never read, totalled, or compared.
 *
 * Hence three tables rather than a column on project_files:
 *
 *   project_receipts    the receipt as a fact — vendor, day, category, money
 *   receipt_line_items  what was on it, when somebody bothers to type it
 *   receipt_images      the photo, kept OFF the receipt row on purpose
 *
 * The photo lives in its own 1:1 table, exactly as invoice_files does for
 * an invoice PDF. That is not tidiness: a base64 data URL is a megabyte in
 * a TEXT column, and a receipts table renders thirty rows at a time. With
 * the blob on the receipt row, every listing would have to remember to
 * enumerate columns and leave `data` out — the footgun listProjectFiles
 * already has to carry a comment about. With it one join away, `SELECT r.*`
 * is cheap forever and no later edit can accidentally make it expensive.
 *
 * Money is DOUBLE PRECISION because every other money column here is
 * (projects.value, quotes.bid_value, quote_line_items.unit_price). NUMERIC
 * would model cents better, but pg has no type parser registered for OID
 * 1700, so it would arrive as a STRING and break money() and every sum
 * that touched it — one correct column bought with a class of silent bugs.
 * Values are rounded to cents on write instead.
 * ==================================================================== */
async function migrateReceipts(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_receipts (
      id            SERIAL PRIMARY KEY,
      project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      -- Nullable on purpose. A photo taken at the counter IS a receipt before
      -- anybody has typed what is on it, and the point of the camera button is
      -- that it can be pressed with one hand while holding the paper. A row
      -- with no vendor, no date and no total is the "needs details" state —
      -- derived from these columns being empty rather than stored as a flag,
      -- so there is no second piece of truth to fall out of step.
      vendor        TEXT,
      purchase_date DATE,
      category      TEXT NOT NULL DEFAULT 'Other',
      subtotal      DOUBLE PRECISION NOT NULL DEFAULT 0,
      tax           DOUBLE PRECISION NOT NULL DEFAULT 0,
      -- What the paper says, and never recomputed from subtotal + tax or from
      -- the line items. A till roll's own arithmetic is the authority: the job
      -- total has to equal the sum of the receipts in the folder, or the number
      -- is no use to anybody reconciling it.
      total         DOUBLE PRECISION NOT NULL DEFAULT 0,
      note          TEXT,
      -- How the fields got their values. Everything is typed today; if reading
      -- receipts off the photo is added later it writes 'extracted', and
      -- 'extracted_edited' once a human has corrected it — so the provenance
      -- of a number is answerable without reshaping either table.
      entry_source  TEXT NOT NULL DEFAULT 'manual',
      -- Denormalised like project_files: the FK for who, the text for what they
      -- were called, so listing receipts never joins users.
      uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      uploader_name TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Declared as DROP/ADD rather than inline in CREATE TABLE so that adding a
    -- sixth cost bucket later is one edit that also lands on databases created
    -- before it — the shape schedule_tasks_hours_check already uses here.
    ALTER TABLE project_receipts DROP CONSTRAINT IF EXISTS project_receipts_category_check;
    ALTER TABLE project_receipts ADD CONSTRAINT project_receipts_category_check
      CHECK (category IN ('Material','Fuel','Tools','Subcontractor','Other'));

    ALTER TABLE project_receipts DROP CONSTRAINT IF EXISTS project_receipts_entry_source_check;
    ALTER TABLE project_receipts ADD CONSTRAINT project_receipts_entry_source_check
      CHECK (entry_source IN ('manual','extracted','extracted_edited'));

    -- A refund is a credit note, not a receipt with a minus on it; nothing in
    -- the UI can produce one, so a negative here is a typo worth refusing.
    ALTER TABLE project_receipts DROP CONSTRAINT IF EXISTS project_receipts_amounts_check;
    ALTER TABLE project_receipts ADD CONSTRAINT project_receipts_amounts_check
      CHECK (subtotal >= 0 AND tax >= 0 AND total >= 0);

    CREATE TABLE IF NOT EXISTS receipt_line_items (
      id          SERIAL PRIMARY KEY,
      receipt_id  INTEGER NOT NULL REFERENCES project_receipts(id) ON DELETE CASCADE,
      -- The order they were typed, which is the order they appear on the paper.
      position    INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL,
      quantity    DOUBLE PRECISION NOT NULL DEFAULT 1,
      unit_price  DOUBLE PRECISION NOT NULL DEFAULT 0,
      -- NULL falls back to quantity * unit_price when rendering, exactly as
      -- quote_line_items.amount does, so a line can be entered either way.
      amount      DOUBLE PRECISION,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- The photo. One receipt, one image: re-uploading replaces rather than
    -- accumulates, the same contract invoice_files has with an invoice.
    CREATE TABLE IF NOT EXISTS receipt_images (
      receipt_id    INTEGER PRIMARY KEY REFERENCES project_receipts(id) ON DELETE CASCADE,
      filename      TEXT NOT NULL,
      mime          TEXT,
      size          INTEGER NOT NULL DEFAULT 0,
      data          TEXT NOT NULL,
      -- A ~20 KB copy of the same image, shrunk in the browser, for the
      -- table's thumbnail column. Without it a thirty-row table pulls thirty
      -- full photos through a no-store route on every render — several
      -- megabytes, over a phone connection, to draw thumbnails 40px wide.
      -- NULL for PDFs and for anything the browser could not decode, which
      -- the table draws as a file tile instead.
      thumb         TEXT,
      uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      uploader_name TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Covers the tab's only query: this job's receipts, newest paper first.
    -- NULLS LAST so a receipt whose date hasn't been typed yet sorts to the
    -- bottom rather than the top.
    CREATE INDEX IF NOT EXISTS idx_receipts_project
      ON project_receipts(project_id, purchase_date DESC NULLS LAST, id DESC);
    CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt
      ON receipt_line_items(receipt_id, position);
  `);
}
