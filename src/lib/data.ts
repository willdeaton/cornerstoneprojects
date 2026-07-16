import 'server-only';
import { getDb } from './db';
import type { Quote, Project, Note, TimeEntry, QuoteStatus, ProjectStatus } from './types';
import { hoursBetween } from './format';

/* ----------------------------------------------------------------- Quotes */

export function listQuotes(status?: QuoteStatus): Quote[] {
  const db = getDb();
  if (status) {
    return db
      .prepare('SELECT * FROM quotes WHERE status = ? ORDER BY bid_value DESC')
      .all(status) as Quote[];
  }
  return db.prepare('SELECT * FROM quotes ORDER BY bid_value DESC').all() as Quote[];
}

export function getQuote(id: number): Quote | undefined {
  return getDb().prepare('SELECT * FROM quotes WHERE id = ?').get(id) as Quote | undefined;
}

export function createQuote(q: {
  customer: string;
  project_name?: string | null;
  category?: string | null;
  bid_value: number;
  date_received?: string | null;
  week_of?: string | null;
  source?: string;
}): number {
  const db = getDb();
  return db
    .prepare(
      `INSERT INTO quotes (customer, project_name, category, bid_value, date_received, week_of, source)
       VALUES (@customer, @project_name, @category, @bid_value, @date_received, @week_of, @source)`
    )
    .run({
      customer: q.customer,
      project_name: q.project_name ?? null,
      category: q.category ?? null,
      bid_value: q.bid_value,
      date_received: q.date_received ?? null,
      week_of: q.week_of ?? null,
      source: q.source ?? 'manual',
    }).lastInsertRowid as number;
}

export function updateQuoteStatus(id: number, status: QuoteStatus): void {
  getDb()
    .prepare("UPDATE quotes SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, id);
}

export function deleteQuote(id: number): void {
  getDb().prepare('DELETE FROM quotes WHERE id = ?').run(id);
}

/** Mark a quote sold and create a matching project. Returns new project id. */
export function convertQuoteToProject(id: number): number | null {
  const db = getDb();
  const q = getQuote(id);
  if (!q) return null;
  const tx = db.transaction(() => {
    const projectId = db
      .prepare(
        `INSERT INTO projects (quote_id, customer, name, category, value, status)
         VALUES (?, ?, ?, ?, ?, 'not_started')`
      )
      .run(id, q.customer, q.project_name ?? q.customer, q.category, q.bid_value)
      .lastInsertRowid as number;
    db.prepare("UPDATE quotes SET status = 'sold', updated_at = datetime('now') WHERE id = ?").run(id);
    return projectId;
  });
  return tx();
}

/* --------------------------------------------------------------- Projects */

export function listProjects(status?: ProjectStatus): Project[] {
  const db = getDb();
  const rows = (
    status
      ? db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY value DESC').all(status)
      : db.prepare('SELECT * FROM projects ORDER BY value DESC').all()
  ) as Project[];
  return rows;
}

export function getProject(id: number): Project | undefined {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
}

export function createProject(p: {
  customer: string;
  name: string;
  category?: string | null;
  value: number;
  status?: ProjectStatus;
  location?: string | null;
  start_date?: string | null;
  due_date?: string | null;
}): number {
  return getDb()
    .prepare(
      `INSERT INTO projects (customer, name, category, value, status, location, start_date, due_date)
       VALUES (@customer, @name, @category, @value, @status, @location, @start_date, @due_date)`
    )
    .run({
      customer: p.customer,
      name: p.name,
      category: p.category ?? null,
      value: p.value,
      status: p.status ?? 'not_started',
      location: p.location ?? null,
      start_date: p.start_date ?? null,
      due_date: p.due_date ?? null,
    }).lastInsertRowid as number;
}

export function updateProject(
  id: number,
  fields: Partial<Pick<Project, 'status' | 'progress' | 'due_date' | 'start_date' | 'location' | 'value' | 'name' | 'category'>>
): void {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = @${k}`).join(', ');
  getDb()
    .prepare(`UPDATE projects SET ${set}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...fields, id });
}

export function deleteProject(id: number): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

/* ------------------------------------------------------------------ Notes */

export function listNotes(projectId: number): Note[] {
  return getDb()
    .prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as Note[];
}

export function addNote(projectId: number, userId: number, authorName: string, body: string): void {
  getDb()
    .prepare('INSERT INTO notes (project_id, user_id, author_name, body) VALUES (?, ?, ?, ?)')
    .run(projectId, userId, authorName, body);
}

export function deleteNote(id: number): void {
  getDb().prepare('DELETE FROM notes WHERE id = ?').run(id);
}

/* ------------------------------------------------------------- Time clock */

export interface TimeEntryWithUser extends TimeEntry {
  user_name: string;
  project_name?: string;
  customer?: string;
}

/** The user's currently-open time entry, if any. */
export function activeEntry(userId: number): (TimeEntry & { project_name: string; customer: string }) | undefined {
  return getDb()
    .prepare(
      `SELECT t.*, p.name AS project_name, p.customer
       FROM time_entries t JOIN projects p ON p.id = t.project_id
       WHERE t.user_id = ? AND t.clock_out IS NULL
       ORDER BY t.clock_in DESC LIMIT 1`
    )
    .get(userId) as (TimeEntry & { project_name: string; customer: string }) | undefined;
}

export function clockIn(userId: number, projectId: number): { ok: boolean; error?: string } {
  const db = getDb();
  if (activeEntry(userId)) {
    return { ok: false, error: 'You are already clocked in. Clock out first.' };
  }
  db.prepare("INSERT INTO time_entries (project_id, user_id, clock_in) VALUES (?, ?, datetime('now'))").run(
    projectId,
    userId
  );
  return { ok: true };
}

export function clockOut(userId: number, note?: string): { ok: boolean; error?: string } {
  const db = getDb();
  const entry = activeEntry(userId);
  if (!entry) return { ok: false, error: 'You are not clocked in.' };
  db.prepare("UPDATE time_entries SET clock_out = datetime('now'), note = ? WHERE id = ?").run(
    note ?? null,
    entry.id
  );
  return { ok: true };
}

export function listProjectTime(projectId: number): TimeEntryWithUser[] {
  return getDb()
    .prepare(
      `SELECT t.*, u.name AS user_name
       FROM time_entries t JOIN users u ON u.id = t.user_id
       WHERE t.project_id = ? ORDER BY t.clock_in DESC`
    )
    .all(projectId) as TimeEntryWithUser[];
}

export function listUserTime(userId: number, limit = 50): TimeEntryWithUser[] {
  return getDb()
    .prepare(
      `SELECT t.*, u.name AS user_name, p.name AS project_name, p.customer
       FROM time_entries t
       JOIN users u ON u.id = t.user_id
       JOIN projects p ON p.id = t.project_id
       WHERE t.user_id = ? ORDER BY t.clock_in DESC LIMIT ?`
    )
    .all(userId, limit) as TimeEntryWithUser[];
}

export function listRecentTime(limit = 25): TimeEntryWithUser[] {
  return getDb()
    .prepare(
      `SELECT t.*, u.name AS user_name, p.name AS project_name, p.customer
       FROM time_entries t
       JOIN users u ON u.id = t.user_id
       JOIN projects p ON p.id = t.project_id
       ORDER BY t.clock_in DESC LIMIT ?`
    )
    .all(limit) as TimeEntryWithUser[];
}

/** Everyone currently clocked in (open entries), across all projects. */
export function listActiveClockIns(): TimeEntryWithUser[] {
  return getDb()
    .prepare(
      `SELECT t.*, u.name AS user_name, p.name AS project_name, p.customer
       FROM time_entries t
       JOIN users u ON u.id = t.user_id
       JOIN projects p ON p.id = t.project_id
       WHERE t.clock_out IS NULL ORDER BY t.clock_in ASC`
    )
    .all() as TimeEntryWithUser[];
}

/** Total logged hours for a project (closed entries only). */
export function projectHours(projectId: number): number {
  const rows = getDb()
    .prepare('SELECT clock_in, clock_out FROM time_entries WHERE project_id = ? AND clock_out IS NOT NULL')
    .all(projectId) as { clock_in: string; clock_out: string }[];
  return rows.reduce((sum, r) => sum + hoursBetween(r.clock_in, r.clock_out), 0);
}

/* -------------------------------------------------------------- Dashboard */

export interface DashboardData {
  totalPipeline: number;
  openPipeline: number;
  soldTotal: number;
  proposalCount: number;
  openQuoteCount: number;
  activeProjectCount: number;
  pipelineByCustomer: { customer: string; value: number }[];
  soldByStatus: { status: ProjectStatus; label: string; value: number; count: number }[];
  categoryBreakdown: { category: string; value: number }[];
}

export function getDashboard(): DashboardData {
  const db = getDb();

  const totalPipeline = (db.prepare('SELECT COALESCE(SUM(bid_value),0) AS v FROM quotes').get() as { v: number }).v;
  const openPipeline = (
    db.prepare("SELECT COALESCE(SUM(bid_value),0) AS v FROM quotes WHERE status = 'open'").get() as { v: number }
  ).v;
  const soldTotal = (db.prepare('SELECT COALESCE(SUM(value),0) AS v FROM projects').get() as { v: number }).v;
  const proposalCount = (db.prepare('SELECT COUNT(*) AS n FROM quotes').get() as { n: number }).n;
  const openQuoteCount = (
    db.prepare("SELECT COUNT(*) AS n FROM quotes WHERE status = 'open'").get() as { n: number }
  ).n;
  const activeProjectCount = (
    db.prepare("SELECT COUNT(*) AS n FROM projects WHERE status != 'completed'").get() as { n: number }
  ).n;

  const pipelineByCustomer = db
    .prepare(
      `SELECT customer, SUM(bid_value) AS value FROM quotes WHERE status = 'open'
       GROUP BY customer ORDER BY value DESC`
    )
    .all() as { customer: string; value: number }[];

  const statusRows = db
    .prepare('SELECT status, SUM(value) AS value, COUNT(*) AS count FROM projects GROUP BY status')
    .all() as { status: ProjectStatus; value: number; count: number }[];
  const statusLabels: Record<ProjectStatus, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    completed: 'Completed',
  };
  const order: ProjectStatus[] = ['in_progress', 'not_started', 'completed'];
  const soldByStatus = order.map((s) => {
    const row = statusRows.find((r) => r.status === s);
    return { status: s, label: statusLabels[s], value: row?.value ?? 0, count: row?.count ?? 0 };
  });

  const categoryBreakdown = db
    .prepare(
      `SELECT COALESCE(category,'Uncategorized') AS category, SUM(bid_value) AS value
       FROM quotes WHERE status = 'open' GROUP BY category ORDER BY value DESC`
    )
    .all() as { category: string; value: number }[];

  return {
    totalPipeline,
    openPipeline,
    soldTotal,
    proposalCount,
    openQuoteCount,
    activeProjectCount,
    pipelineByCustomer,
    soldByStatus,
    categoryBreakdown,
  };
}

/* ------------------------------------------------------------------ Users */

export interface UserRow {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'worker';
  active: number;
  created_at: string;
}

export function listUsers(): UserRow[] {
  return getDb()
    .prepare('SELECT id, name, email, role, active, created_at FROM users ORDER BY active DESC, name')
    .all() as UserRow[];
}

export function listActiveWorkers(): UserRow[] {
  return getDb()
    .prepare("SELECT id, name, email, role, active, created_at FROM users WHERE active = 1 ORDER BY name")
    .all() as UserRow[];
}

export function emailExists(email: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM users WHERE email = ?')
    .get(email.trim().toLowerCase());
  return !!row;
}

export function createUserRow(u: {
  name: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'manager' | 'worker';
}): number {
  return getDb()
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(u.name, u.email.trim().toLowerCase(), u.password_hash, u.role).lastInsertRowid as number;
}

export function setUserRole(id: number, role: 'admin' | 'manager' | 'worker'): void {
  getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
}

export function setUserActive(id: number, active: boolean): void {
  getDb().prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  if (!active) {
    // end any open time entries and drop sessions for a deactivated user
    getDb()
      .prepare("UPDATE time_entries SET clock_out = datetime('now') WHERE user_id = ? AND clock_out IS NULL")
      .run(id);
    getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
}

export function setUserPassword(id: number, passwordHash: string): void {
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
}

export function countAdmins(): number {
  return (
    getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get() as {
      n: number;
    }
  ).n;
}

export function getUserRole(id: number): string | undefined {
  const row = getDb().prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined;
  return row?.role;
}
