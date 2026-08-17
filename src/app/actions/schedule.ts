'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  createScheduleTask,
  updateScheduleTask,
  deleteScheduleTask,
  getScheduleTask,
  listScheduleTasks,
  listScheduleChanges,
  listTaskInputs,
  listAssigneeContacts,
  getPublishedVersion,
  publishSchedule,
  unpublishSchedule,
  logScheduleChange,
  setTaskAssignees,
  createSubcontractor,
  updateSubcontractor,
  deleteSubcontractor,
  addHoliday,
  deleteHoliday,
  type AssigneeInput,
} from '@/lib/schedule-data';
import { sendScheduleEmails, type SendScheduleResult } from '@/lib/email/send';
import { addDays, normalizeMask, wouldCycle } from '@/lib/schedule-math';
import {
  diffTask,
  needsReason,
  summarizeChanges,
  summarizePhase,
  type DiffNames,
  type TaskDraft,
} from '@/lib/schedule-diff';
import type { DependsType, ScheduleChange, TaskStatus } from '@/lib/types';

/** Result of a save/delete action. */
export interface ActionResult {
  ok: boolean;
  error?: string;
  /**
   * Set when the job's schedule is published and the change needs a reason the
   * caller didn't supply — the editor turns this into a required field rather
   * than an error the user has to decode.
   */
  needsReason?: boolean;
}

/** Only admins and managers build the schedule; everyone else reads it. */
async function requireManager() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin' && user.role !== 'manager') {
    throw new Error('Not authorized.');
  }
  return user;
}

/** Trim to a non-empty string, or null. */
function clean(v: unknown): string | null {
  const t = (v ?? '').toString().trim();
  return t === '' ? null : t;
}

/** Postgres unique-violation (duplicate subcontractor name). */
function isUniqueViolation(err: unknown): boolean {
  return (
    !!err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505'
  );
}

/** Refresh every view that renders schedule data for a job. */
function revalidateSchedule(projectId?: number) {
  revalidatePath('/schedule');
  if (projectId) revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
  revalidatePath('/dashboard');
}

/* ---------------------------------------------------------------- Phases */

export interface TaskFields {
  /** Existing phase id, or omitted to create one. */
  id?: number;
  project_id: number;
  name: string;
  start_date: string;
  duration_days: number;
  depends_on_id?: number | null;
  /** Whether the link hangs off the predecessor's finish or its start. */
  depends_type?: DependsType;
  lag_days?: number;
  status?: TaskStatus;
  notes?: string | null;
  assignees?: AssigneeInput[];
  /**
   * Why this changed. Required once the job's schedule has been published, for
   * any edit that moves work or people (see saveTaskAction).
   */
  reason?: string | null;
}

/**
 * Name lookups for the change log: phase names come from the job's own phases,
 * people from the schedulable roster. Anyone already assigned contributes their
 * name too — the roster only lists active people, and someone since deactivated
 * would otherwise read as a different person and fake a crew change.
 */
async function diffNames(projectId: number): Promise<DiffNames> {
  const [tasks, contacts] = await Promise.all([
    listScheduleTasks({ projectId }),
    listAssigneeContacts(),
  ]);
  const phases = new Map(tasks.map((t) => [t.id, t.name]));
  const people = new Map(contacts.map((c) => [c.key, c.name]));
  for (const t of tasks) {
    for (const a of t.assignees ?? []) {
      if (!people.has(`${a.kind}:${a.ref_id}`)) people.set(`${a.kind}:${a.ref_id}`, a.name);
    }
  }
  return {
    phase: (id) => phases.get(id) ?? 'a deleted phase',
    person: (kind, refId) => people.get(`${kind}:${refId}`) ?? `#${refId}`,
  };
}

/**
 * Create or update one phase together with its assignee list. Rejects a
 * dependency that points at another job or that would close a loop, so the
 * solver in schedule-math never has to untangle one after the fact.
 *
 * Once the job's schedule is published, any edit that moves work or people has
 * to carry `reason`; it's recorded against the published version along with a
 * summary of what actually changed.
 */
export async function saveTaskAction(input: TaskFields): Promise<ActionResult> {
  const me = await requireManager();

  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, error: 'Phase name is required.' };
  if (!input.project_id) return { ok: false, error: 'Pick a job for this phase.' };
  if (!input.start_date) return { ok: false, error: 'A start date is required.' };

  const duration = Math.max(1, Math.round(Number(input.duration_days) || 1));
  const lag = Math.max(0, Math.round(Number(input.lag_days) || 0));
  const dependsOn = input.depends_on_id ?? null;
  const dependsType: DependsType =
    input.depends_type === 'start_to_start' ? 'start_to_start' : 'finish_to_start';

  if (dependsOn != null) {
    const pred = await getScheduleTask(dependsOn);
    if (!pred) return { ok: false, error: 'The phase it follows no longer exists.' };
    if (pred.project_id !== input.project_id) {
      return { ok: false, error: 'A phase can only follow another phase on the same job.' };
    }
    if (input.id) {
      // Check the link against the job as it will be, so an edit that closes a
      // loop is caught before it's written.
      const existing = await listTaskInputs(input.project_id);
      const proposed = existing.map((t) =>
        t.id === input.id ? { ...t, depends_on_id: dependsOn } : t
      );
      if (wouldCycle(proposed, input.id, dependsOn)) {
        return {
          ok: false,
          error: 'That would make the phases depend on each other in a loop.',
        };
      }
    }
  }

  const assignees = (input.assignees ?? []).map((a) => ({
    ...a,
    work_days: normalizeMask(a.work_days),
  }));

  const fields = {
    name,
    start_date: input.start_date,
    duration_days: duration,
    depends_on_id: dependsOn,
    depends_type: dependsType,
    lag_days: lag,
    status: input.status ?? ('not_started' as TaskStatus),
    notes: clean(input.notes),
  };

  const published = await getPublishedVersion(input.project_id);
  const before = input.id ? await getScheduleTask(input.id) : undefined;
  const reason = clean(input.reason);

  // What moved, in the same words the editor previewed.
  let summary = summarizePhase({ name, start_date: fields.start_date, duration_days: duration });
  let mustExplain = !!published;
  if (before) {
    const draft: TaskDraft = { ...fields, assignees };
    const changes = diffTask(
      {
        name: before.name,
        start_date: before.start_date,
        duration_days: before.duration_days,
        depends_on_id: before.depends_on_id,
        depends_type: before.depends_type ?? 'finish_to_start',
        lag_days: before.lag_days,
        notes: before.notes,
        status: before.status,
        assignees: before.assignees ?? [],
      },
      draft,
      await diffNames(input.project_id)
    );
    if (changes.length === 0) {
      // Nothing to write and nothing to explain.
      revalidateSchedule(input.project_id);
      return { ok: true };
    }
    summary = summarizeChanges(changes);
    mustExplain = !!published && needsReason(changes);
  }

  if (mustExplain && !reason) {
    return {
      ok: false,
      needsReason: true,
      error: `This job's schedule was published (v${published!.version}). Add a reason for the change.`,
    };
  }

  let taskId = input.id ?? 0;
  if (taskId) {
    await updateScheduleTask(taskId, fields);
  } else {
    taskId = await createScheduleTask({ project_id: input.project_id, ...fields });
  }

  if (input.assignees) await setTaskAssignees(taskId, assignees);

  if (published && reason) {
    await logScheduleChange({
      project_id: input.project_id,
      task_id: taskId,
      task_name: name,
      kind: before ? 'updated' : 'added',
      summary,
      reason,
      version: published.version,
      changed_by: me.id,
    });
  }

  revalidateSchedule(input.project_id);
  return { ok: true };
}

export async function deleteTaskAction(id: number, reason?: string | null): Promise<ActionResult> {
  const me = await requireManager();
  const task = await getScheduleTask(id);
  if (!task) return { ok: true };

  const published = await getPublishedVersion(task.project_id);
  const why = clean(reason);
  if (published && !why) {
    return {
      ok: false,
      needsReason: true,
      error: `This job's schedule was published (v${published.version}). Add a reason for removing this phase.`,
    };
  }

  await deleteScheduleTask(id);

  if (published && why) {
    await logScheduleChange({
      project_id: task.project_id,
      task_id: null,
      task_name: task.name,
      kind: 'deleted',
      summary: `Removed ${summarizePhase(task)}`,
      reason: why,
      version: published.version,
      changed_by: me.id,
    });
  }

  revalidateSchedule(task.project_id);
  return { ok: true };
}

/**
 * Marking a phase not started / in progress / complete is progress reporting,
 * not a schedule change, so it needs no reason even on a published job.
 */
export async function setTaskStatusAction(id: number, status: TaskStatus): Promise<ActionResult> {
  await requireManager();
  const task = await getScheduleTask(id);
  if (!task) return { ok: false, error: 'That phase no longer exists.' };
  await updateScheduleTask(id, { status });
  revalidateSchedule(task.project_id);
  return { ok: true };
}

/**
 * Nudge a phase's earliest start by whole calendar days. Anything following it
 * moves too, since downstream dates are always derived from this one.
 */
export async function shiftTaskAction(
  id: number,
  days: number,
  reason?: string | null
): Promise<ActionResult> {
  const me = await requireManager();
  const task = await getScheduleTask(id);
  if (!task) return { ok: false, error: 'That phase no longer exists.' };

  const published = await getPublishedVersion(task.project_id);
  const why = clean(reason);
  if (published && !why) {
    return {
      ok: false,
      needsReason: true,
      error: `This job's schedule was published (v${published.version}). Add a reason for moving this phase.`,
    };
  }

  const moved = addDays(task.start_date, Math.round(days));
  await updateScheduleTask(id, { start_date: moved });

  if (published && why) {
    await logScheduleChange({
      project_id: task.project_id,
      task_id: task.id,
      task_name: task.name,
      kind: 'updated',
      summary: `Start ${task.start_date} → ${moved}`,
      reason: why,
      version: published.version,
      changed_by: me.id,
    });
  }

  revalidateSchedule(task.project_id);
  return { ok: true };
}

/* ------------------------------------------------- Publishing & history */

/**
 * Mark a job's schedule as published — the dates the crew has been told. From
 * here on, edits to its phases need a reason. Publishing again bumps the
 * version, which is how a manager re-baselines after a round of changes.
 */
export async function publishScheduleAction(
  projectId: number,
  note?: string | null
): Promise<ActionResult & { version?: number }> {
  const me = await requireManager();
  if (!projectId) return { ok: false, error: 'Pick a job to publish.' };
  const version = await publishSchedule(projectId, me.id, clean(note));
  revalidateSchedule(projectId);
  return { ok: true, version };
}

/** Undo a publish (admins only) — for a job published by mistake. */
export async function unpublishScheduleAction(projectId: number): Promise<ActionResult> {
  const me = await requireManager();
  if (me.role !== 'admin') {
    return { ok: false, error: 'Only an admin can un-publish a schedule.' };
  }
  await unpublishSchedule(projectId);
  revalidateSchedule(projectId);
  return { ok: true };
}

/** The reasons logged against one job, newest first. */
export async function getScheduleHistoryAction(projectId: number): Promise<ScheduleChange[]> {
  await requireManager();
  return listScheduleChanges(projectId);
}

/* -------------------------------------------------------- Subcontractors */

export interface SubcontractorFields {
  id?: number;
  name: string;
  trade?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  active?: boolean;
}

export async function saveSubcontractorAction(
  input: SubcontractorFields
): Promise<ActionResult> {
  await requireManager();
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, error: 'Subcontractor name is required.' };
  const payload = {
    name,
    trade: clean(input.trade),
    contact_name: clean(input.contact_name),
    phone: clean(input.phone),
    email: clean(input.email),
    notes: clean(input.notes),
    active: input.active ?? true,
  };
  try {
    if (input.id) await updateSubcontractor(input.id, payload);
    else await createSubcontractor(payload);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: 'A subcontractor with that name already exists.' };
    }
    throw err;
  }
  revalidatePath('/settings/subcontractors');
  revalidatePath('/schedule');
  return { ok: true };
}

export async function deleteSubcontractorAction(id: number): Promise<ActionResult> {
  await requireManager();
  await deleteSubcontractor(id);
  revalidatePath('/settings/subcontractors');
  revalidatePath('/schedule');
  return { ok: true };
}

/* -------------------------------------------------------------- Holidays */

export async function saveHolidayAction(day: string, label: string | null): Promise<ActionResult> {
  await requireManager();
  if (!day) return { ok: false, error: 'Pick a date.' };
  await addHoliday(day, clean(label));
  revalidatePath('/settings/schedule');
  revalidateSchedule();
  return { ok: true };
}

export async function deleteHolidayAction(day: string): Promise<ActionResult> {
  await requireManager();
  await deleteHoliday(day);
  revalidatePath('/settings/schedule');
  revalidateSchedule();
  return { ok: true };
}

/* ---------------------------------------------------------- Send schedule */

/**
 * Email everyone scheduled in the date range their own list of work. Best-effort
 * per recipient — the result reports who was skipped and why.
 *
 * `publish` marks every job covered by the send as published, since that send is
 * the moment the crew was told these dates. Changes to those jobs afterwards
 * need a reason.
 */
export async function sendScheduleAction(
  from: string,
  to: string,
  includeSubs: boolean,
  publish = false
): Promise<SendScheduleResult & { published?: number }> {
  const me = await requireManager();
  if (!from || !to || to < from) {
    return {
      status: 'error',
      count: 0,
      attempted: 0,
      reason: 'Pick a valid date range.',
      skipped: [],
    };
  }
  const result = await sendScheduleEmails(from, to, includeSubs);

  if (!publish || result.status === 'error') return result;

  const ids = result.projectIds ?? [];
  for (const id of ids) {
    await publishSchedule(id, me.id, `Schedule sent for ${from} – ${to}`);
    revalidateSchedule(id);
  }
  return { ...result, published: ids.length };
}
