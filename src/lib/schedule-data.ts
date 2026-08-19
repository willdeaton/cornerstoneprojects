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
} from './types';
import { normalizeMask } from './schedule-math';
import type { TaskInput, WorkCalendar } from './schedule-math';

/*
 * Queries for job scheduling: the subcontractor catalog, job phases with their
 * assignees, and the non-working-day list. Derived dates live in
 * ./schedule-math — nothing here computes or stores a real start/end.
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
 * Each phase joined to its job, with assignees folded in as JSON so one query
 * feeds the whole timeline. Employees contribute their role as `detail`, subs
 * their trade.
 */
const TASK_SELECT = `
  SELECT t.*,
         p.name             AS project_name,
         p.customer         AS customer,
         p.location         AS location,
         p.site_address     AS site_address,
         p.status           AS project_status,
         p.due_date         AS project_due_date,
         p.hard_finish_date AS project_hard_finish_date,
         COALESCE(a.assignees, '[]'::json) AS assignees,
         COALESCE(dt.day_times, '[]'::json) AS day_times
    FROM schedule_tasks t
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN (
      SELECT d.task_id,
             json_agg(
               json_build_object('day', d.day, 'start_time', d.start_time)
               ORDER BY d.day
             ) AS day_times
        FROM schedule_task_day_times d
       GROUP BY d.task_id
    ) dt ON dt.task_id = t.id
    LEFT JOIN (
      SELECT sa.task_id,
             json_agg(
               json_build_object(
                 'id',     sa.id,
                 'kind',   CASE WHEN sa.user_id IS NOT NULL THEN 'user' ELSE 'sub' END,
                 'ref_id', COALESCE(sa.user_id, sa.subcontractor_id),
                 'name',   COALESCE(u.name, s.name),
                 'detail', COALESCE(u.role, s.trade),
                 'work_days', sa.work_days
               ) ORDER BY COALESCE(u.name, s.name)
             ) AS assignees
        FROM schedule_assignments sa
        LEFT JOIN users u          ON u.id = sa.user_id
        LEFT JOIN subcontractors s ON s.id = sa.subcontractor_id
       GROUP BY sa.task_id
    ) a ON a.task_id = t.id
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
  depends_on_id?: number | null;
  depends_type?: DependsType;
  lag_days?: number;
  status?: TaskStatus;
  /** Daily start time as 'HH:MM', or null for the crew's normal hours. */
  start_time?: string | null;
  notes?: string | null;
}): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO schedule_tasks
       (project_id, name, start_date, duration_days, depends_on_id, depends_type, lag_days, status, start_time, notes, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       (SELECT COALESCE(MAX(position), 0) + 1 FROM schedule_tasks WHERE project_id = $1))
     RETURNING id`,
    [
      t.project_id,
      t.name,
      t.start_date,
      Math.max(1, t.duration_days),
      t.depends_on_id ?? null,
      t.depends_type ?? 'finish_to_start',
      t.lag_days ?? 0,
      t.status ?? 'not_started',
      t.start_time ?? null,
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
      | 'depends_on_id'
      | 'depends_type'
      | 'lag_days'
      | 'status'
      | 'start_time'
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

/* ---------------------------------------------------------- Assignments */

export interface AssigneeInput {
  kind: 'user' | 'sub';
  /** users.id or subcontractors.id. */
  ref_id: number;
  /**
   * Day-of-week mask (bit 0 = Sunday … bit 6 = Saturday), or null/undefined for
   * every working day of the phase. Lets one employee take Mon/Wed on this job
   * and be free for another on Tuesday.
   */
  work_days?: number | null;
}

/**
 * Replace a phase's assignee list wholesale, in one transaction, so the editor
 * can add and remove people (and change their day patterns) with a single save.
 */
export async function setTaskAssignees(taskId: number, assignees: AssigneeInput[]): Promise<void> {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM schedule_assignments WHERE task_id = $1', [taskId]);
    for (const a of assignees) {
      await client.query(
        `INSERT INTO schedule_assignments (task_id, user_id, subcontractor_id, work_days)
         VALUES ($1,$2,$3,$4)`,
        [
          taskId,
          a.kind === 'user' ? a.ref_id : null,
          a.kind === 'sub' ? a.ref_id : null,
          normalizeMask(a.work_days),
        ]
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

/* ------------------------------------------------------- Day start times */

/** One day of a phase given its own start time (null clears the day's time). */
export interface DayTimeInput {
  day: string;
  start_time: string | null;
}

/**
 * Replace a phase's per-day start times wholesale, mirroring how assignees are
 * saved: the editor sends the full list and anything missing from it goes back
 * to the phase's own daily start time.
 */
export async function setTaskDayTimes(taskId: number, days: DayTimeInput[]): Promise<void> {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM schedule_task_day_times WHERE task_id = $1', [taskId]);
    for (const d of days) {
      await client.query(
        'INSERT INTO schedule_task_day_times (task_id, day, start_time) VALUES ($1,$2,$3)',
        [taskId, d.day, d.start_time]
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

/** Crew notes for several jobs at once — one query for a worker's own schedule. */
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
