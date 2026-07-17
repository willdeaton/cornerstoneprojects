import 'server-only';
import { getDb } from './db';
import type { Quote, Project, Note, TimeEntry, ProjectFile, QuoteStatus, ProjectStatus } from './types';
import { hoursBetween } from './format';

/* -------------------------------------------------------------- Query helpers */

async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  const res = await db.query(text, params);
  return res.rows as T[];
}

async function one<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const rows = await q<T>(text, params);
  return rows[0];
}

/* ----------------------------------------------------------------- Quotes */

export async function listQuotes(status?: QuoteStatus): Promise<Quote[]> {
  if (status) {
    return q<Quote>('SELECT * FROM quotes WHERE status = $1 ORDER BY bid_value DESC', [status]);
  }
  return q<Quote>('SELECT * FROM quotes ORDER BY bid_value DESC');
}

export async function getQuote(id: number): Promise<Quote | undefined> {
  return one<Quote>('SELECT * FROM quotes WHERE id = $1', [id]);
}

export async function createQuote(quote: {
  customer: string;
  quote_number?: string | null;
  project_name?: string | null;
  category?: string | null;
  bid_value: number;
  date_received?: string | null;
  week_of?: string | null;
  source?: string;
}): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO quotes (quote_number, customer, project_name, category, bid_value, date_received, week_of, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      quote.quote_number ?? null,
      quote.customer,
      quote.project_name ?? null,
      quote.category ?? null,
      quote.bid_value,
      quote.date_received ?? null,
      quote.week_of ?? null,
      quote.source ?? 'manual',
    ]
  );
  return row!.id;
}

export async function updateQuote(
  id: number,
  fields: Partial<Pick<Quote, 'quote_number' | 'customer' | 'project_name' | 'category' | 'bid_value' | 'date_received'>>
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const set = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ');
  const values = entries.map(([, v]) => v);
  await q(`UPDATE quotes SET ${set}, updated_at = now() WHERE id = $${entries.length + 1}`, [...values, id]);
}

export async function updateQuoteStatus(id: number, status: QuoteStatus): Promise<void> {
  await q('UPDATE quotes SET status = $1, updated_at = now() WHERE id = $2', [status, id]);
}

export async function deleteQuote(id: number): Promise<void> {
  await q('DELETE FROM quotes WHERE id = $1', [id]);
}

/** Mark a quote sold and create a matching project. Returns new project id. */
export async function convertQuoteToProject(id: number): Promise<number | null> {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM quotes WHERE id = $1', [id]);
    const quote = rows[0] as Quote | undefined;
    if (!quote) {
      await client.query('ROLLBACK');
      return null;
    }
    const inserted = await client.query(
      `INSERT INTO projects (quote_id, quote_number, customer, name, category, value, status)
       VALUES ($1,$2,$3,$4,$5,$6,'not_started') RETURNING id`,
      [id, quote.quote_number, quote.customer, quote.project_name ?? quote.customer, quote.category, quote.bid_value]
    );
    const projectId = inserted.rows[0].id as number;
    await client.query("UPDATE quotes SET status = 'sold', updated_at = now() WHERE id = $1", [id]);
    await client.query('COMMIT');
    return projectId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* --------------------------------------------------------------- Projects */

export async function listProjects(status?: ProjectStatus): Promise<Project[]> {
  if (status) {
    return q<Project>('SELECT * FROM projects WHERE status = $1 ORDER BY value DESC', [status]);
  }
  return q<Project>('SELECT * FROM projects ORDER BY value DESC');
}

export async function getProject(id: number): Promise<Project | undefined> {
  return one<Project>('SELECT * FROM projects WHERE id = $1', [id]);
}

export async function createProject(p: {
  customer: string;
  name: string;
  quote_number?: string | null;
  category?: string | null;
  value: number;
  status?: ProjectStatus;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  due_date?: string | null;
}): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO projects (customer, name, quote_number, category, value, status, location, start_date, end_date, due_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      p.customer,
      p.name,
      p.quote_number ?? null,
      p.category ?? null,
      p.value,
      p.status ?? 'not_started',
      p.location ?? null,
      p.start_date ?? null,
      p.end_date ?? null,
      p.due_date ?? null,
    ]
  );
  return row!.id;
}

export async function updateProject(
  id: number,
  fields: Partial<
    Pick<
      Project,
      | 'status'
      | 'progress'
      | 'due_date'
      | 'start_date'
      | 'end_date'
      | 'location'
      | 'value'
      | 'name'
      | 'category'
      | 'quote_number'
      | 'invoice_numbers'
      | 'invoice_notes'
    >
  >
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const set = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ');
  const values = entries.map(([, v]) => v);
  await q(`UPDATE projects SET ${set}, updated_at = now() WHERE id = $${entries.length + 1}`, [...values, id]);
}

export async function deleteProject(id: number): Promise<void> {
  await q('DELETE FROM projects WHERE id = $1', [id]);
}

/* -------------------------------------------------------- Project files */

export async function listProjectFiles(projectId: number): Promise<ProjectFile[]> {
  // Deliberately omit `data` (the base64 blob) from listings.
  return q<ProjectFile>(
    `SELECT id, project_id, filename, mime, size, uploaded_by, uploader_name, created_at
     FROM project_files WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
}

export async function getProjectFile(
  id: number
): Promise<(ProjectFile & { data: string }) | undefined> {
  return one<ProjectFile & { data: string }>('SELECT * FROM project_files WHERE id = $1', [id]);
}

export async function addProjectFile(f: {
  project_id: number;
  filename: string;
  mime: string | null;
  size: number;
  data: string;
  uploaded_by: number | null;
  uploader_name: string | null;
}): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO project_files (project_id, filename, mime, size, data, uploaded_by, uploader_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [f.project_id, f.filename, f.mime, f.size, f.data, f.uploaded_by, f.uploader_name]
  );
  return row!.id;
}

export async function deleteProjectFile(id: number): Promise<void> {
  await q('DELETE FROM project_files WHERE id = $1', [id]);
}

/* ------------------------------------------------------------------ Notes */

export async function listNotes(projectId: number): Promise<Note[]> {
  return q<Note>('SELECT * FROM notes WHERE project_id = $1 ORDER BY created_at DESC', [projectId]);
}

export async function addNote(
  projectId: number,
  userId: number,
  authorName: string,
  body: string
): Promise<void> {
  await q('INSERT INTO notes (project_id, user_id, author_name, body) VALUES ($1,$2,$3,$4)', [
    projectId,
    userId,
    authorName,
    body,
  ]);
}

export async function deleteNote(id: number): Promise<void> {
  await q('DELETE FROM notes WHERE id = $1', [id]);
}

/* ------------------------------------------------------------- Time clock */

export interface TimeEntryWithUser extends TimeEntry {
  user_name: string;
  project_name?: string | null;
  customer?: string | null;
}

/** An open (unclosed) time entry with the current break state, if any. */
export interface ActiveEntry extends TimeEntry {
  project_name: string | null;
  customer: string | null;
  on_break: boolean;
  break_start: string | null;
}

/** The user's currently-open time entry, if any. */
export async function activeEntry(userId: number): Promise<ActiveEntry | undefined> {
  return one<ActiveEntry>(
    `SELECT t.*, p.name AS project_name, p.customer,
            b.break_start,
            (b.id IS NOT NULL) AS on_break
     FROM time_entries t
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN time_breaks b ON b.time_entry_id = t.id AND b.break_end IS NULL
     WHERE t.user_id = $1 AND t.clock_out IS NULL
     ORDER BY t.clock_in DESC LIMIT 1`,
    [userId]
  );
}

/** Clock in. A null projectId is a general clock-in not tied to a job. */
export async function clockIn(
  userId: number,
  projectId: number | null
): Promise<{ ok: boolean; error?: string }> {
  if (await activeEntry(userId)) {
    return { ok: false, error: 'You are already clocked in. Clock out first.' };
  }
  await q('INSERT INTO time_entries (project_id, user_id, clock_in) VALUES ($1, $2, now())', [
    projectId,
    userId,
  ]);
  return { ok: true };
}

export async function clockOut(userId: number, note?: string): Promise<{ ok: boolean; error?: string }> {
  const entry = await activeEntry(userId);
  if (!entry) return { ok: false, error: 'You are not clocked in.' };
  // Close any lunch break still running so the shift total stays accurate.
  await q('UPDATE time_breaks SET break_end = now() WHERE time_entry_id = $1 AND break_end IS NULL', [
    entry.id,
  ]);
  await q('UPDATE time_entries SET clock_out = now(), note = $1 WHERE id = $2', [note ?? null, entry.id]);
  return { ok: true };
}

/** Start a lunch break on the user's active shift. */
export async function startBreak(userId: number): Promise<{ ok: boolean; error?: string }> {
  const entry = await activeEntry(userId);
  if (!entry) return { ok: false, error: 'Clock in before starting a break.' };
  if (entry.on_break) return { ok: false, error: 'You are already on a break.' };
  await q('INSERT INTO time_breaks (time_entry_id, break_start) VALUES ($1, now())', [entry.id]);
  return { ok: true };
}

/** End the running lunch break on the user's active shift. */
export async function endBreak(userId: number): Promise<{ ok: boolean; error?: string }> {
  const entry = await activeEntry(userId);
  if (!entry) return { ok: false, error: 'You are not clocked in.' };
  if (!entry.on_break) return { ok: false, error: 'You are not on a break.' };
  await q('UPDATE time_breaks SET break_end = now() WHERE time_entry_id = $1 AND break_end IS NULL', [
    entry.id,
  ]);
  return { ok: true };
}

export async function listProjectTime(projectId: number): Promise<TimeEntryWithUser[]> {
  return q<TimeEntryWithUser>(
    `SELECT t.*, u.name AS user_name
     FROM time_entries t JOIN users u ON u.id = t.user_id
     WHERE t.project_id = $1 ORDER BY t.clock_in DESC`,
    [projectId]
  );
}

export async function listUserTime(userId: number, limit = 50): Promise<TimeEntryWithUser[]> {
  return q<TimeEntryWithUser>(
    `SELECT t.*, u.name AS user_name, p.name AS project_name, p.customer
     FROM time_entries t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.user_id = $1 ORDER BY t.clock_in DESC LIMIT $2`,
    [userId, limit]
  );
}

export async function listRecentTime(limit = 25): Promise<TimeEntryWithUser[]> {
  return q<TimeEntryWithUser>(
    `SELECT t.*, u.name AS user_name, p.name AS project_name, p.customer
     FROM time_entries t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN projects p ON p.id = t.project_id
     ORDER BY t.clock_in DESC LIMIT $1`,
    [limit]
  );
}

/** Everyone currently clocked in (open entries), across all projects. */
export async function listActiveClockIns(): Promise<(TimeEntryWithUser & { on_break: boolean })[]> {
  return q<TimeEntryWithUser & { on_break: boolean }>(
    `SELECT t.*, u.name AS user_name, p.name AS project_name, p.customer,
            EXISTS (
              SELECT 1 FROM time_breaks b WHERE b.time_entry_id = t.id AND b.break_end IS NULL
            ) AS on_break
     FROM time_entries t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.clock_out IS NULL ORDER BY t.clock_in ASC`
  );
}

/** Total logged hours for a project (closed entries only, minus breaks). */
export async function projectHours(projectId: number): Promise<number> {
  const row = await one<{ hours: number }>(
    `SELECT COALESCE(SUM(
              EXTRACT(EPOCH FROM (t.clock_out - t.clock_in))
              - COALESCE((
                  SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(b.break_end, t.clock_out) - b.break_start)))
                  FROM time_breaks b WHERE b.time_entry_id = t.id
                ), 0)
            ), 0) / 3600.0 AS hours
     FROM time_entries t
     WHERE t.project_id = $1 AND t.clock_out IS NOT NULL`,
    [projectId]
  );
  return Math.max(0, row?.hours ?? 0);
}

/** Net hours (minus breaks) the user has logged in the last 7 days. */
export async function weekNetHours(userId: number): Promise<number> {
  const row = await one<{ hours: number }>(
    `SELECT COALESCE(SUM(
              EXTRACT(EPOCH FROM (t.clock_out - t.clock_in))
              - COALESCE((
                  SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(b.break_end, t.clock_out) - b.break_start)))
                  FROM time_breaks b WHERE b.time_entry_id = t.id
                ), 0)
            ), 0) / 3600.0 AS hours
     FROM time_entries t
     WHERE t.user_id = $1 AND t.clock_out IS NOT NULL
       AND t.clock_in > now() - INTERVAL '7 days'`,
    [userId]
  );
  return Math.max(0, row?.hours ?? 0);
}

/* ------------------------------------------- Time clock: payroll review */

export interface AdminTimeEntry {
  id: number;
  user_id: number;
  user_name: string;
  project_name: string | null;
  customer: string | null;
  clock_in: string;
  clock_out: string | null;
  note: string | null;
  paid: boolean;
  break_minutes: number;
  net_hours: number;
}

export interface AdminWeekUser {
  user_id: number;
  user_name: string;
  entries: AdminTimeEntry[];
  total_hours: number;
  paid_hours: number;
  unpaid_hours: number;
  closed_count: number;
  all_paid: boolean;
}

export interface AdminWeek {
  week_start: string;
  users: AdminWeekUser[];
  total_hours: number;
  unpaid_hours: number;
  fully_paid: boolean;
}

/**
 * Time entries for the last `weeks` weeks, grouped by ISO week (Mon-start)
 * and then by employee, with break-adjusted net hours and paid status.
 */
export async function adminTimeByWeek(weeks = 8): Promise<AdminWeek[]> {
  const rows = await q<{
    id: number;
    user_id: number;
    user_name: string;
    project_name: string | null;
    customer: string | null;
    clock_in: string;
    clock_out: string | null;
    note: string | null;
    paid: boolean;
    week_start: string;
    break_seconds: number;
  }>(
    `SELECT t.id, t.user_id, u.name AS user_name,
            p.name AS project_name, p.customer,
            t.clock_in, t.clock_out, t.note, t.paid,
            to_char(date_trunc('week', t.clock_in), 'YYYY-MM-DD') AS week_start,
            COALESCE((
              SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(b.break_end, t.clock_out, now()) - b.break_start)))
              FROM time_breaks b WHERE b.time_entry_id = t.id
            ), 0) AS break_seconds
     FROM time_entries t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.clock_in >= date_trunc('week', CURRENT_DATE) - (($1::int - 1) * INTERVAL '1 week')
     ORDER BY t.clock_in DESC`,
    [weeks]
  );

  const weekMap = new Map<string, Map<number, AdminWeekUser>>();

  for (const r of rows) {
    const breakMinutes = Math.round(r.break_seconds / 60);
    const gross = hoursBetween(r.clock_in, r.clock_out);
    const netHours = Math.max(0, gross - r.break_seconds / 3600);

    const entry: AdminTimeEntry = {
      id: r.id,
      user_id: r.user_id,
      user_name: r.user_name,
      project_name: r.project_name,
      customer: r.customer,
      clock_in: r.clock_in,
      clock_out: r.clock_out,
      note: r.note,
      paid: r.paid,
      break_minutes: breakMinutes,
      net_hours: netHours,
    };

    let byUser = weekMap.get(r.week_start);
    if (!byUser) {
      byUser = new Map();
      weekMap.set(r.week_start, byUser);
    }
    let u = byUser.get(r.user_id);
    if (!u) {
      u = {
        user_id: r.user_id,
        user_name: r.user_name,
        entries: [],
        total_hours: 0,
        paid_hours: 0,
        unpaid_hours: 0,
        closed_count: 0,
        all_paid: true,
      };
      byUser.set(r.user_id, u);
    }
    u.entries.push(entry);
    if (r.clock_out) {
      u.total_hours += netHours;
      u.closed_count += 1;
      if (r.paid) u.paid_hours += netHours;
      else {
        u.unpaid_hours += netHours;
        u.all_paid = false;
      }
    }
  }

  const weeks_out: AdminWeek[] = [...weekMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([week_start, byUser]) => {
      const users = [...byUser.values()].sort((a, b) => a.user_name.localeCompare(b.user_name));
      const total_hours = users.reduce((s, u) => s + u.total_hours, 0);
      const unpaid_hours = users.reduce((s, u) => s + u.unpaid_hours, 0);
      return {
        week_start,
        users,
        total_hours,
        unpaid_hours,
        fully_paid: users.every((u) => u.all_paid),
      };
    });

  return weeks_out;
}

/** Mark a single time entry paid/unpaid. */
export async function setEntryPaid(entryId: number, paid: boolean, adminId: number): Promise<void> {
  await q(
    `UPDATE time_entries
     SET paid = $1,
         paid_at = CASE WHEN $1 THEN now() ELSE NULL END,
         paid_by = CASE WHEN $1 THEN $2::int ELSE NULL END
     WHERE id = $3`,
    [paid, adminId, entryId]
  );
}

/** Mark every closed entry for a user in a given ISO week paid/unpaid. */
export async function setWeekPaid(
  userId: number,
  weekStart: string,
  paid: boolean,
  adminId: number
): Promise<void> {
  await q(
    `UPDATE time_entries
     SET paid = $1,
         paid_at = CASE WHEN $1 THEN now() ELSE NULL END,
         paid_by = CASE WHEN $1 THEN $2::int ELSE NULL END
     WHERE user_id = $3
       AND clock_out IS NOT NULL
       AND date_trunc('week', clock_in) = date_trunc('week', $4::date)`,
    [paid, adminId, userId, weekStart]
  );
}

/* -------------------------------------------------------------- Dashboard */

export interface QuoteLite {
  id: number;
  quote_number: string | null;
  customer: string;
  project_name: string | null;
  bid_value: number;
  status: QuoteStatus;
}

export interface ProjectLite {
  id: number;
  name: string;
  customer: string;
  value: number;
  status: ProjectStatus;
}

export interface WeekBucket {
  week_start: string;
  count: number;
  value: number;
  quotes: QuoteLite[];
}

export interface DecisionRow {
  id: number;
  quote_number: string | null;
  customer: string;
  project_name: string | null;
  category: string | null;
  bid_value: number;
  status: 'sold' | 'lost';
  updated_at: string;
}

export interface DashboardData {
  totalPipeline: number;
  openPipeline: number;
  soldTotal: number;
  proposalCount: number;
  openQuoteCount: number;
  activeProjectCount: number;
  pipelineByCustomer: { customer: string; value: number; quotes: QuoteLite[] }[];
  soldByStatus: { status: ProjectStatus; label: string; value: number; count: number; projects: ProjectLite[] }[];
  categoryBreakdown: { category: string; value: number }[];
  quotesByWeek: WeekBucket[];
  recentDecisions: DecisionRow[];
}

export async function getDashboard(): Promise<DashboardData> {
  // These queries are independent, so run them concurrently.
  const [
    kpis,
    openQuotes,
    allProjects,
    categoryBreakdown,
    weekStarts,
    windowQuotes,
    recentDecisions,
  ] = await Promise.all([
    one<{
      total_pipeline: number;
      open_pipeline: number;
      sold_total: number;
      proposal_count: number;
      open_quote_count: number;
      active_project_count: number;
    }>(
      `SELECT
         (SELECT COALESCE(SUM(bid_value),0) FROM quotes) AS total_pipeline,
         (SELECT COALESCE(SUM(bid_value),0) FROM quotes WHERE status = 'open') AS open_pipeline,
         (SELECT COALESCE(SUM(value),0) FROM projects) AS sold_total,
         (SELECT COUNT(*) FROM quotes) AS proposal_count,
         (SELECT COUNT(*) FROM quotes WHERE status = 'open') AS open_quote_count,
         (SELECT COUNT(*) FROM projects WHERE status != 'completed') AS active_project_count`
    ),
    q<QuoteLite>(
      `SELECT id, quote_number, customer, project_name, bid_value, status
       FROM quotes WHERE status = 'open' ORDER BY bid_value DESC`
    ),
    q<ProjectLite>('SELECT id, name, customer, value, status FROM projects'),
    q<{ category: string; value: number }>(
      `SELECT COALESCE(category,'Uncategorized') AS category, SUM(bid_value) AS value
       FROM quotes WHERE status = 'open' GROUP BY category ORDER BY value DESC`
    ),
    q<{ week_start: string }>(
      `SELECT to_char(gs, 'YYYY-MM-DD') AS week_start
       FROM generate_series(
         date_trunc('week', CURRENT_DATE) - INTERVAL '7 weeks',
         date_trunc('week', CURRENT_DATE),
         INTERVAL '1 week'
       ) gs`
    ),
    q<QuoteLite & { week_start: string }>(
      `SELECT id, quote_number, customer, project_name, bid_value, status,
              to_char(date_trunc('week', COALESCE(date_received, created_at::date)), 'YYYY-MM-DD') AS week_start
       FROM quotes
       WHERE COALESCE(date_received, created_at::date)
             >= (date_trunc('week', CURRENT_DATE) - INTERVAL '7 weeks')::date
       ORDER BY bid_value DESC`
    ),
    q<DecisionRow>(
      `SELECT id, quote_number, customer, project_name, category, bid_value, status, updated_at
       FROM quotes
       WHERE status IN ('sold','lost') AND updated_at >= now() - INTERVAL '14 days'
       ORDER BY updated_at DESC`
    ),
  ]);

  const totalPipeline = kpis!.total_pipeline;
  const openPipeline = kpis!.open_pipeline;
  const soldTotal = kpis!.sold_total;
  const proposalCount = kpis!.proposal_count;
  const openQuoteCount = kpis!.open_quote_count;
  const activeProjectCount = kpis!.active_project_count;

  // Open quotes grouped by customer (with the underlying quotes for drill-down).
  const byCustomer = new Map<string, { customer: string; value: number; quotes: QuoteLite[] }>();
  for (const qt of openQuotes) {
    const entry = byCustomer.get(qt.customer) ?? { customer: qt.customer, value: 0, quotes: [] };
    entry.value += qt.bid_value;
    entry.quotes.push(qt);
    byCustomer.set(qt.customer, entry);
  }
  const pipelineByCustomer = [...byCustomer.values()].sort((a, b) => b.value - a.value);

  // Projects grouped by status (with the underlying projects for drill-down).
  const statusLabels: Record<ProjectStatus, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    completed: 'Completed',
  };
  const order: ProjectStatus[] = ['in_progress', 'not_started', 'completed'];
  const soldByStatus = order.map((s) => {
    const projects = allProjects.filter((p) => p.status === s);
    return {
      status: s,
      label: statusLabels[s],
      value: projects.reduce((sum, p) => sum + p.value, 0),
      count: projects.length,
      projects,
    };
  });

  // Quotes by week for the past 8 weeks (bucketed on when the quote came in).
  const quotesByWeek: WeekBucket[] = weekStarts.map((w) => {
    const quotes = windowQuotes.filter((qt) => qt.week_start === w.week_start);
    return {
      week_start: w.week_start,
      count: quotes.length,
      value: quotes.reduce((sum, qt) => sum + qt.bid_value, 0),
      quotes: quotes.map(({ week_start, ...rest }) => rest),
    };
  });

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
    quotesByWeek,
    recentDecisions,
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

export async function listUsers(): Promise<UserRow[]> {
  return q<UserRow>(
    'SELECT id, name, email, role, active, created_at FROM users ORDER BY active DESC, name'
  );
}

export async function listActiveWorkers(): Promise<UserRow[]> {
  return q<UserRow>(
    'SELECT id, name, email, role, active, created_at FROM users WHERE active = 1 ORDER BY name'
  );
}

export async function emailExists(email: string): Promise<boolean> {
  const row = await one('SELECT 1 FROM users WHERE email = $1', [email.trim().toLowerCase()]);
  return !!row;
}

export async function createUserRow(u: {
  name: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'manager' | 'worker';
}): Promise<number> {
  const row = await one<{ id: number }>(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id',
    [u.name, u.email.trim().toLowerCase(), u.password_hash, u.role]
  );
  return row!.id;
}

export async function setUserRole(id: number, role: 'admin' | 'manager' | 'worker'): Promise<void> {
  await q('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
}

export async function setUserActive(id: number, active: boolean): Promise<void> {
  await q('UPDATE users SET active = $1 WHERE id = $2', [active ? 1 : 0, id]);
  if (!active) {
    // end any open time entries and drop sessions for a deactivated user
    await q('UPDATE time_entries SET clock_out = now() WHERE user_id = $1 AND clock_out IS NULL', [id]);
    await q('DELETE FROM sessions WHERE user_id = $1', [id]);
  }
}

export async function setUserPassword(id: number, passwordHash: string): Promise<void> {
  await q('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
  await q('DELETE FROM sessions WHERE user_id = $1', [id]);
}

export async function countAdmins(): Promise<number> {
  return (await one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1"
  ))!.n;
}

export async function getUserRole(id: number): Promise<string | undefined> {
  const row = await one<{ role: string }>('SELECT role FROM users WHERE id = $1', [id]);
  return row?.role;
}
