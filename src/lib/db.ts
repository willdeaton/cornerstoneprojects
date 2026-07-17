import 'server-only';
import { Pool, types } from 'pg';
import { ensureSeed } from './seed';

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
      role          TEXT NOT NULL DEFAULT 'worker' CHECK (role IN ('admin','manager','worker')),
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
      description TEXT NOT NULL,
      quantity    DOUBLE PRECISION NOT NULL DEFAULT 1,
      unit        TEXT,
      unit_price  DOUBLE PRECISION NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS terms             TEXT;
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS prepared_by       TEXT;

    CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
    CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_line_items(quote_id);
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
    CREATE INDEX IF NOT EXISTS idx_time_project ON time_entries(project_id);
    CREATE INDEX IF NOT EXISTS idx_time_user ON time_entries(user_id);
    CREATE INDEX IF NOT EXISTS idx_files_project ON project_files(project_id);
  `);
}
