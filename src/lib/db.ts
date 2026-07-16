import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { ensureSeed } from './seed';

// Cache the connection across hot-reloads in dev.
const g = globalThis as unknown as { __csdb?: Database.Database };

function createConnection(): Database.Database {
  const dataDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'tracker.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  ensureSeed(db);
  return db;
}

export function getDb(): Database.Database {
  if (!g.__csdb) {
    g.__csdb = createConnection();
  }
  return g.__csdb;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'worker' CHECK (role IN ('admin','manager','worker')),
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      customer      TEXT NOT NULL,
      project_name  TEXT,
      category      TEXT,
      bid_value     REAL NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','sold','lost')),
      date_received TEXT,
      week_of       TEXT,
      source        TEXT NOT NULL DEFAULT 'manual',
      notes         TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id    INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
      customer    TEXT NOT NULL,
      name        TEXT NOT NULL,
      category    TEXT,
      value       REAL NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed')),
      progress    INTEGER NOT NULL DEFAULT 0,
      location    TEXT,
      start_date  TEXT,
      due_date    TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      body        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      clock_in    TEXT NOT NULL,
      clock_out   TEXT,
      note        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
    CREATE INDEX IF NOT EXISTS idx_time_project ON time_entries(project_id);
    CREATE INDEX IF NOT EXISTS idx_time_user ON time_entries(user_id);
  `);
}
