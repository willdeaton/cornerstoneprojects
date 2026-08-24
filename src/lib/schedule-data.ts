import 'server-only';
import { getDb } from './db';
import { q, one } from './data';
import type {
  CrewNote,
  DependsType,
  ProjectStatus,
  ScheduleChange,
  SchedulePublication,
  ScheduleTask,
  ScheduleTaskRow,
  Subcontractor,
  TaskStatus,
  WarehouseDay,
} from './types';
import type { TaskInput, WorkCalendar } from './schedule-math';

/*
 * Queries for job scheduling: the subcontractor catalog, job phases with the
 * crew booked on each of their days, and the non-working-day list. Derived
 * dates live in ./schedule-math — nothing here computes or stores a real
 * start/end.
 */

/* --------------------------------------------------------- Subcontractors */

export async function listSubcontractors(
  opts: { activeOnly?: boolean } = {}
): Promise<Subcontractor[]> {
  const where = opts.activeOnly ? 'WHERE active = TRUE' : '';
  return q<Subcontractor>(`SELECT * FROM subcontractors ${where} ORDER BY name`);
}

export async function getSubcontractor(id: number): Promise<Subcontractor | undefined> {
  return one<Subcontractor>('SELECT * FROM subcontractors WHERE id = $1', [id]);
}

export async function createSubcontractor(s: {
  name: string;
  trade?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  active?: boolean;
}): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO subcontractors (name, trade, contact_name, phone, email, notes, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      s.name,
      s.trade ?? null,
      s.contact_name ?? null,
      s.phone ?? null,
      s.email ?? null,
      s.notes ?? null,
      s.active ?? true,
    ]
  );
  return row!.id;
}

export async function updateSubcontractor(
  id: number,
  fields: Partial<
    Pick<Subcontractor, 'name' | 'trade' | 'contact_name' | 'phone' | 'email' | 'notes' | 'active'>
  >
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const set = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ');
  await q(`UPDATE subcontractors SET ${set}, updated_at = now() WHERE id = $${entries.length + 1}`, [
    ...entries.map(([, v]) => v),
    id,
  ]);
}

export async function deleteSubcontractor(id: number): Promise<void> {
  await q('DELETE FROM subcontractors WHERE id = $1', [id]);
}

/* -------------------------------------------------------------- Phases */

/** Job phases considered "live" by default — the ones worth scheduling. */
const ACTIVE_STATUSES: ProjectStatus[] = ['not_started', 'in_progress'];

/**
 * Each phase joined to its job, with its day-by-day crew and any per-day start
 * times folded in as JSON so one query feeds the whole timeline and crew week.
 * Employees contribute their role as `detail`, subs their trade.
 */
const TASK_SELECT = `
  SELECT t.*,
         p.name             AS project_name,
         p.customer         AS customer,
         p.quote_number     AS quote_number,
         p.category         AS project_category,
         p.value            AS project_value,
         p.location         AS location,
         p.site_address     AS site_address,
         p.status           AS project_status,
         p.due_date         AS project_due_date,
         p.hard_finish_date AS project_hard_finish_date,
         p.on_hold          AS project_on_hold,
         p.on_hold_reason   AS project_on_hold_reason,
         p.on_hold_since    AS project_on_hold_since,
         sub.name           AS subcontractor_name,
         COALESCE(cd.crew_days, '[]'::json) AS crew_days,
         COALESCE(dt.day_times, '[]'::json) AS day_times
    FROM schedule_tasks t
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN subcontractors sub ON sub.id = t.subcontractor_id
    LEFT JOIN (
      SELECT d.task_id,
             json_agg(
               json_build_object('day', d.day, 'start_time', d.start_time, 'hours', d.hours)
               ORDER BY d.day
             ) AS day_times
        FROM schedule_task_day_times d
       GROUP BY d.task_id
    ) dt ON dt.task_id = t.id
    LEFT JOIN (
      SELECT c.task_id,
             json_agg(
               json_build_object(
                 'id',     c.id,
                 'day',    c.day,
                 'kind',   CASE WHEN c.user_id IS NOT NULL THEN 'user' ELSE 'sub' END,
                 'ref_id', COALESCE(c.user_id, c.subcontractor_id),
                 'name',   COALESCE(u.name, s.name),
                 'detail', COALESCE(u.role, s.trade)
               ) ORDER BY c.day, COALESCE(u.name, s.name)
             ) AS crew_days
        FROM schedule_crew_days c
        LEFT JOIN users u          ON u.id = c.user_id
        LEFT JOIN subcontractors s ON s.id = c.subcontractor_id
       GROUP BY c.task_id
    ) cd ON cd.task_id = t.id
`;

export async function listScheduleTasks(
  opts: { projectId?: number; statuses?: ProjectStatus[] } = {}
): Promise<ScheduleTaskRow[]> {
  if (opts.projectId != null) {
    return q<ScheduleTaskRow>(
      `${TASK_SELECT} WHERE t.project_id = $1 ORDER BY t.position, t.start_date, t.id`,
      [opts.projectId]
    );
  }
  const statuses = opts.statuses ?? ACTIVE_STATUSES;
  return q<ScheduleTaskRow>(
    `${TASK_SELECT} WHERE p.status = ANY($1) ORDER BY p.name, t.position, t.start_date, t.id`,
    [statuses]
  );
}

export async function getScheduleTask(id: number): Promise<ScheduleTaskRow | undefined> {
  return one<ScheduleTaskRow>(`${TASK_SELECT} WHERE t.id = $1`, [id]);
}

/**
 * How far back the schedule keeps finished jobs on screen: paging back through
 * the weeks shows the work that actually ran, not just the jobs still open.
 */
export const HISTORY_WEEKS = 26;

/**
 * A finished job is loaded whole or not at all, so the prefilter has to work off
 * the stored start dates alone — the real windows are derived, and a phase can
 * land well after its own earliest start once the chain in front of it has been
 * resolved. `duration_days * 2` covers the weekends a working-day duration
 * spans, and the slack covers that push. Being generous only means a job is
 * loaded and never drawn: every view clips to the weeks on screen anyway.
 */
const HISTORY_SLACK_DAYS = 30;

/**
 * Phases of jobs that are finished, for the weeks the schedule can page back
 * to. Kept apart from `listScheduleTasks` on purpose: this is history, and
 * nothing that plans or emails work should pick it up by accident.
 *
 * A job comes back with every one of its phases, whether or not that phase is
 * itself inside the window — the dependency chain is what turns a stored start
 * date into a real one, and a chain missing a link resolves to the wrong dates.
 */
export async function listCompletedJobTasks(since: string): Promise<ScheduleTaskRow[]> {
  return q<ScheduleTaskRow>(
    `${TASK_SELECT}
      WHERE p.status = 'completed'
        AND EXISTS (
          SELECT 1 FROM schedule_tasks h
           WHERE h.project_id = t.project_id
             AND h.start_date + (h.duration_days * 2) + ${HISTORY_SLACK_DAYS} >= $1::date
        )
      ORDER BY p.name, t.position, t.start_date, t.id`,
    [since]
  );
}

/**
 * The bare fields the dependency solver needs, for every phase on a job. Used
 * when validating a proposed dependency link without loading the full rows.
 */
export async function listTaskInputs(projectId: number): Promise<TaskInput[]> {
  return q<TaskInput>(
    `SELECT id, project_id, start_date, duration_days, depends_on_id, depends_type, lag_days
       FROM schedule_tasks WHERE project_id = $1`,
    [projectId]
  );
}

export async function createScheduleTask(t: {
  project_id: number;
  name: string;
  start_date: string;
  duration_days: number;
  /** Our people needed per day; with the duration, the phase's crew budget. */
  crew_size?: number;
  /** The sub doing this phase, or null when it's our own crew's work. */
  subcontractor_id?: number | null;
  depends_on_id?: number | null;
  depends_type?: DependsType;
  lag_days?: number;
  status?: TaskStatus;
  /** Daily start time as 'HH:MM', or null for the crew's normal hours. */
  start_time?: string | null;
  /** Hours on site each day; null (the default) is all day. */
  hours?: number | null;
  notes?: string | null;
}): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO schedule_tasks
       (project_id, name, start_date, duration_days, crew_size, subcontractor_id, depends_on_id, depends_type, lag_days, status, start_time, hours, notes, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
       (SELECT COALESCE(MAX(position), 0) + 1 FROM schedule_tasks WHERE project_id = $1))
     RETURNING id`,
    [
      t.project_id,
      t.name,
      t.start_date,
      Math.max(1, t.duration_days),
      Math.max(0, t.crew_size ?? 1),
      t.subcontractor_id ?? null,
      t.depends_on_id ?? null,
      t.depends_type ?? 'finish_to_start',
      t.lag_days ?? 0,
      t.status ?? 'not_started',
      t.start_time ?? null,
      t.hours ?? null,
      t.notes ?? null,
    ]
  );
  return row!.id;
}

export async function updateScheduleTask(
  id: number,
  fields: Partial<
    Pick<
      ScheduleTask,
      | 'name'
      | 'start_date'
      | 'duration_days'
      | 'crew_size'
      | 'subcontractor_id'
      | 'depends_on_id'
      | 'depends_type'
      | 'lag_days'
      | 'status'
      | 'start_time'
      | 'hours'
      | 'notes'
      | 'position'
    >
  >
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const set = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ');
  await q(`UPDATE schedule_tasks SET ${set}, updated_at = now() WHERE id = $${entries.length + 1}`, [
    ...entries.map(([, v]) => v),
    id,
  ]);
}

export async function deleteScheduleTask(id: number): Promise<void> {
  await q('DELETE FROM schedule_tasks WHERE id = $1', [id]);
}

/** How many phases follow this one — so the UI can warn before deleting it. */
export async function countDependents(taskId: number): Promise<number> {
  const row = await one<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM schedule_tasks WHERE depends_on_id = $1',
    [taskId]
  );
  return row?.n ?? 0;
}

/* ----------------------------------------------------------- Crew days */

/** One person booked on one day of a phase. */
export interface CrewDayInput {
  day: string;
  kind: 'user' | 'sub';
  /** users.id or subcontractors.id. */
  ref_id: number;
}

/**
 * Book one person onto one day of a phase, refusing to spend more crew-days
 * than the phase was planned for.
 *
 * The cap is checked and the row written in one transaction, with the phase
 * locked for the duration: two managers staffing the same job at the same
 * moment would otherwise both read "one slot left" and both take it.
 * `capacity` is the caller's crew_size x working-days figure — the working-day
 * count is derived from the dependency chain, so only the caller can know it.
 */
export async function addCrewDay(
  taskId: number,
  entry: CrewDayInput,
  capacity: number
): Promise<{ ok: true } | { ok: false; reason: 'full' | 'duplicate' }> {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM schedule_tasks WHERE id = $1 FOR UPDATE', [taskId]);
    const { rows } = await client.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM schedule_crew_days WHERE task_id = $1',
      [taskId]
    );
    if ((rows[0]?.n ?? 0) >= capacity) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'full' };
    }
    const inserted = await client.query(
      `INSERT INTO schedule_crew_days (task_id, day, user_id, subcontractor_id)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [
        taskId,
        entry.day,
        entry.kind === 'user' ? entry.ref_id : null,
        entry.kind === 'sub' ? entry.ref_id : null,
      ]
    );
    await client.query('COMMIT');
    // Already on that day — the click landed twice, or two tabs are open.
    return inserted.rowCount ? { ok: true } : { ok: false, reason: 'duplicate' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Book one person onto several days of a phase in one pass — what dropping a job
 * card on somebody's name does, where "put them on this phase" means every day
 * of it that's on screen.
 *
 * Same cap and same lock as `addCrewDay`, held across the whole run so a
 * fortnight's worth of days can't slip past the budget one insert at a time.
 * Days already booked for that person are skipped rather than failing the run,
 * and once the phase is full the rest are left alone: the caller is told how
 * many landed so it can say so.
 */
export async function addCrewDays(
  taskId: number,
  days: string[],
  who: Omit<CrewDayInput, 'day'>,
  capacity: number
): Promise<{ booked: number; skipped: number; full: boolean }> {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM schedule_tasks WHERE id = $1 FOR UPDATE', [taskId]);
    const { rows } = await client.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM schedule_crew_days WHERE task_id = $1',
      [taskId]
    );
    let filled = rows[0]?.n ?? 0;
    let booked = 0;
    let skipped = 0;
    for (const day of days) {
      if (filled >= capacity) break;
      const inserted = await client.query(
        `INSERT INTO schedule_crew_days (task_id, day, user_id, subcontractor_id)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [taskId, day, who.kind === 'user' ? who.ref_id : null, who.kind === 'sub' ? who.ref_id : null]
      );
      if (inserted.rowCount) {
        booked++;
        filled++;
      } else {
        skipped++;
      }
    }
    await client.query('COMMIT');
    return { booked, skipped, full: filled >= capacity && booked + skipped < days.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Take one person off one day of a phase. */
export async function removeCrewDay(taskId: number, entry: CrewDayInput): Promise<void> {
  await q(
    `DELETE FROM schedule_crew_days
      WHERE task_id = $1 AND day = $2
        AND ${entry.kind === 'user' ? 'user_id' : 'subcontractor_id'} = $3`,
    [taskId, entry.day, entry.ref_id]
  );
}

/**
 * Drop crew-day rows that no longer fall inside a phase's window — what a phase
 * that has been shortened or moved leaves behind. Called with the window the
 * solver just produced, so nobody stays booked on a day the phase isn't on.
 */
export async function pruneCrewDays(
  taskId: number,
  window: { start: string; end: string } | null
): Promise<number> {
  const dropped = window
    ? await q<{ id: number }>(
        `DELETE FROM schedule_crew_days
          WHERE task_id = $1 AND (day < $2 OR day > $3) RETURNING id`,
        [taskId, window.start, window.end]
      )
    : await q<{ id: number }>(
        'DELETE FROM schedule_crew_days WHERE task_id = $1 RETURNING id',
        [taskId]
      );
  return dropped.length;
}

/** How many crew-days a phase has booked — the spent half of its budget. */
export async function countCrewDays(taskId: number): Promise<number> {
  const row = await one<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM schedule_crew_days WHERE task_id = $1',
    [taskId]
  );
  return row?.n ?? 0;
}

/* ------------------------------------------------------- Day start times */

/**
 * One day of a phase given its own shift. A null start time clears the day's
 * time; null hours make it all day, whatever the phase's own length is.
 */
export interface DayTimeInput {
  day: string;
  start_time: string | null;
  hours: number | null;
}

/**
 * Replace a phase's per-day shifts wholesale: the crew-week job card sends the
 * full list and anything missing from it goes back to the phase's own daily
 * start time and length.
 */
export async function setTaskDayTimes(taskId: number, days: DayTimeInput[]): Promise<void> {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM schedule_task_day_times WHERE task_id = $1', [taskId]);
    for (const d of days) {
      await client.query(
        'INSERT INTO schedule_task_day_times (task_id, day, start_time, hours) VALUES ($1,$2,$3,$4)',
        [taskId, d.day, d.start_time, d.hours ?? null]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------ Crew notes */

/**
 * Job-specific messages for the crew, pinned ones first then newest. These are
 * read by everyone booked on the job, so they're kept apart from the internal
 * job notes in `notes`.
 */
export async function listCrewNotes(projectId: number): Promise<CrewNote[]> {
  return q<CrewNote>(
    `SELECT * FROM crew_notes WHERE project_id = $1
      ORDER BY pinned DESC, created_at DESC, id DESC`,
    [projectId]
  );
}

/** Crew notes for several jobs at once — one query for one person's own schedule. */
export async function listCrewNotesForProjects(projectIds: number[]): Promise<CrewNote[]> {
  if (projectIds.length === 0) return [];
  return q<CrewNote>(
    `SELECT * FROM crew_notes WHERE project_id = ANY($1::int[])
      ORDER BY project_id, pinned DESC, created_at DESC, id DESC`,
    [projectIds]
  );
}

export async function createCrewNote(n: {
  project_id: number;
  body: string;
  pinned?: boolean;
  author_id: number | null;
  author_name: string;
}): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO crew_notes (project_id, body, pinned, author_id, author_name)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [n.project_id, n.body, n.pinned ?? false, n.author_id, n.author_name]
  );
  return row!.id;
}

export async function updateCrewNote(
  id: number,
  fields: Partial<Pick<CrewNote, 'body' | 'pinned'>>
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const set = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ');
  await q(`UPDATE crew_notes SET ${set}, updated_at = now() WHERE id = $${entries.length + 1}`, [
    ...entries.map(([, v]) => v),
    id,
  ]);
}

export async function getCrewNote(id: number): Promise<CrewNote | undefined> {
  return one<CrewNote>('SELECT * FROM crew_notes WHERE id = $1', [id]);
}

export async function deleteCrewNote(id: number): Promise<void> {
  await q('DELETE FROM crew_notes WHERE id = $1', [id]);
}

/**
 * Everyone schedulable, keyed the same way assignee windows are ('user:4' /
 * 'sub:2'), with the address to reach them at. Employee addresses follow the
 * app-wide chain personal_email -> work_email -> email; subs have just the one.
 */
export interface AssigneeContact {
  key: string;
  name: string;
  email: string | null;
}

export async function listAssigneeContacts(): Promise<AssigneeContact[]> {
  return q<AssigneeContact>(
    `SELECT 'user:' || id AS key, name, COALESCE(personal_email, work_email, email) AS email
       FROM users WHERE active = 1
      UNION ALL
     SELECT 'sub:' || id AS key, name, email
       FROM subcontractors WHERE active = TRUE`
  );
}

/* ------------------------------------------------------- Warehouse days */

/*
 * The standing warehouse card. Job phases are staffed against a window and a
 * crew budget; the warehouse has neither, so its bookings are their own rows
 * and their own queries rather than a phase pretending to run forever.
 */

/** Everyone in the warehouse, optionally narrowed to a range or one person. */
export async function listWarehouseDays(
  opts: { from?: string; to?: string; userId?: number } = {}
): Promise<WarehouseDay[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.from) {
    params.push(opts.from);
    where.push(`w.day >= $${params.length}`);
  }
  if (opts.to) {
    params.push(opts.to);
    where.push(`w.day <= $${params.length}`);
  }
  if (opts.userId != null) {
    params.push(opts.userId);
    where.push(`w.user_id = $${params.length}`);
  }
  return q<WarehouseDay>(
    `SELECT w.id, w.day, w.user_id, u.name, u.role AS detail
       FROM warehouse_days w
       JOIN users u ON u.id = w.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY w.day, u.name`,
    params
  );
}

/**
 * Put one person in the warehouse for a run of days. Days they already have
 * are left alone rather than failing the run — the same forgiveness a phase's
 * span booking gives — and the number that landed comes back so the caller can
 * say so.
 */
export async function addWarehouseDays(userId: number, days: string[]): Promise<number> {
  if (days.length === 0) return 0;
  const rows = await q<{ id: number }>(
    `INSERT INTO warehouse_days (user_id, day)
     SELECT $1, d::date FROM unnest($2::text[]) AS d
     ON CONFLICT (day, user_id) DO NOTHING
     RETURNING id`,
    [userId, days]
  );
  return rows.length;
}

/** Take one person out of the warehouse for one day. */
export async function removeWarehouseDay(userId: number, day: string): Promise<void> {
  await q('DELETE FROM warehouse_days WHERE user_id = $1 AND day = $2', [userId, day]);
}

/* ------------------------------------------------------------- Holidays */

export interface Holiday {
  day: string;
  label: string | null;
}

export async function listHolidays(): Promise<Holiday[]> {
  return q<Holiday>('SELECT day, label FROM schedule_holidays ORDER BY day');
}

export async function addHoliday(day: string, label: string | null): Promise<void> {
  await q(
    `INSERT INTO schedule_holidays (day, label) VALUES ($1,$2)
     ON CONFLICT (day) DO UPDATE SET label = EXCLUDED.label`,
    [day, label]
  );
}

export async function deleteHoliday(day: string): Promise<void> {
  await q('DELETE FROM schedule_holidays WHERE day = $1', [day]);
}

/** The holiday list shaped as the working-day calendar the solver expects. */
export async function loadWorkCalendar(): Promise<WorkCalendar> {
  const rows = await listHolidays();
  return { holidays: new Set(rows.map((r) => r.day)) };
}

/* --------------------------------------------- Publishing & change history */

/**
 * The current published version of each job's schedule, keyed by project id.
 * A job missing from the map has never been published, so its phases can still
 * be edited freely — no reason required.
 */
export async function listPublishedVersions(): Promise<Map<number, SchedulePublication>> {
  const rows = await q<SchedulePublication>(
    `SELECT DISTINCT ON (p.project_id)
            p.*, u.name AS published_by_name
       FROM schedule_publications p
       LEFT JOIN users u ON u.id = p.published_by
      ORDER BY p.project_id, p.version DESC`
  );
  return new Map(rows.map((r) => [r.project_id, r]));
}

export async function getPublishedVersion(
  projectId: number
): Promise<SchedulePublication | undefined> {
  return one<SchedulePublication>(
    `SELECT p.*, u.name AS published_by_name
       FROM schedule_publications p
       LEFT JOIN users u ON u.id = p.published_by
      WHERE p.project_id = $1
      ORDER BY p.version DESC
      LIMIT 1`,
    [projectId]
  );
}

/**
 * Publish (or re-publish) a job's schedule, bumping its version. Re-publishing
 * is how a manager says "this is the new baseline" after a batch of changes;
 * the change log keeps every reason recorded against the version it followed.
 */
export async function publishSchedule(
  projectId: number,
  publishedBy: number | null,
  note: string | null
): Promise<number> {
  const row = await one<{ version: number }>(
    `INSERT INTO schedule_publications (project_id, version, note, published_by)
     VALUES ($1,
             (SELECT COALESCE(MAX(version), 0) + 1 FROM schedule_publications WHERE project_id = $1),
             $2, $3)
     RETURNING version`,
    [projectId, note, publishedBy]
  );
  return row!.version;
}

export async function unpublishSchedule(projectId: number): Promise<void> {
  await q('DELETE FROM schedule_publications WHERE project_id = $1', [projectId]);
}

export async function logScheduleChange(c: {
  project_id: number;
  task_id: number | null;
  task_name: string | null;
  kind: ScheduleChange['kind'];
  summary: string;
  reason: string;
  version: number | null;
  changed_by: number | null;
}): Promise<void> {
  await q(
    `INSERT INTO schedule_changes
       (project_id, task_id, task_name, kind, summary, reason, version, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      c.project_id,
      c.task_id,
      c.task_name,
      c.kind,
      c.summary,
      c.reason,
      c.version,
      c.changed_by,
    ]
  );
}

/** Change history for one job, newest first. */
export async function listScheduleChanges(
  projectId: number,
  limit = 50
): Promise<ScheduleChange[]> {
  return q<ScheduleChange>(
    `SELECT c.*, u.name AS changed_by_name
       FROM schedule_changes c
       LEFT JOIN users u ON u.id = c.changed_by
      WHERE c.project_id = $1
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT $2`,
    [projectId, limit]
  );
}

/** How many reasons have been logged per job — for the board's revision badge. */
export async function countScheduleChanges(): Promise<Map<number, number>> {
  const rows = await q<{ project_id: number; n: number }>(
    'SELECT project_id, COUNT(*)::int AS n FROM schedule_changes GROUP BY project_id'
  );
  return new Map(rows.map((r) => [r.project_id, r.n]));
}

/* ------------------------------------------- Unsent changes (draft state) */

/**
 * A job whose schedule has moved since the crew was last told. The row exists
 * only while there is something unsent: publishing the job deletes it.
 */
export interface ScheduleDraftJob {
  project_id: number;
  project_name: string;
  customer: string;
  changed_at: string;
  changed_by_name: string | null;
}

/**
 * Note that this job's schedule no longer matches what the crew has. Called by
 * every action that changes the plan — phases, bookings, start times, crew
 * notes — so Publish can list exactly what is outstanding.
 */
export async function markScheduleChanged(
  projectId: number,
  changedBy: number | null
): Promise<void> {
  await q(
    `INSERT INTO schedule_draft_state (project_id, changed_at, changed_by)
     VALUES ($1, now(), $2)
     ON CONFLICT (project_id)
     DO UPDATE SET changed_at = now(), changed_by = EXCLUDED.changed_by`,
    [projectId, changedBy]
  );
}

/** The crew now has these dates, so nothing is outstanding on this job. */
export async function clearScheduleChanged(projectId: number): Promise<void> {
  await q('DELETE FROM schedule_draft_state WHERE project_id = $1', [projectId]);
}

/**
 * Every live job with changes the crew hasn't been sent, oldest change first —
 * what the schedule's Publish button offers, and the order it worries about
 * them in. Completed jobs are left out: nobody needs to be emailed dates for
 * work that is finished.
 */
export async function listScheduleDrafts(): Promise<ScheduleDraftJob[]> {
  return q<ScheduleDraftJob>(
    `SELECT d.project_id,
            p.name     AS project_name,
            p.customer AS customer,
            d.changed_at,
            u.name     AS changed_by_name
       FROM schedule_draft_state d
       JOIN projects p ON p.id = d.project_id
       LEFT JOIN users u ON u.id = d.changed_by
      WHERE p.status <> 'completed'
      ORDER BY d.changed_at`
  );
}
