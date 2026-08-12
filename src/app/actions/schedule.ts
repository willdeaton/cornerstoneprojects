'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  createScheduleTask,
  updateScheduleTask,
  deleteScheduleTask,
  getScheduleTask,
  listTaskInputs,
  setTaskAssignees,
  createSubcontractor,
  updateSubcontractor,
  deleteSubcontractor,
  addHoliday,
  deleteHoliday,
  type AssigneeInput,
} from '@/lib/schedule-data';
import { sendScheduleEmails, type SendScheduleResult } from '@/lib/email/send';
import { addDays, wouldCycle } from '@/lib/schedule-math';
import type { TaskStatus } from '@/lib/types';

/** Result of a save/delete action. */
export interface ActionResult {
  ok: boolean;
  error?: string;
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
  lag_days?: number;
  status?: TaskStatus;
  notes?: string | null;
  assignees?: AssigneeInput[];
}

/**
 * Create or update one phase together with its assignee list. Rejects a
 * dependency that points at another job or that would close a loop, so the
 * solver in schedule-math never has to untangle one after the fact.
 */
export async function saveTaskAction(input: TaskFields): Promise<ActionResult> {
  await requireManager();

  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, error: 'Phase name is required.' };
  if (!input.project_id) return { ok: false, error: 'Pick a job for this phase.' };
  if (!input.start_date) return { ok: false, error: 'A start date is required.' };

  const duration = Math.max(1, Math.round(Number(input.duration_days) || 1));
  const lag = Math.max(0, Math.round(Number(input.lag_days) || 0));
  const dependsOn = input.depends_on_id ?? null;

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

  const fields = {
    name,
    start_date: input.start_date,
    duration_days: duration,
    depends_on_id: dependsOn,
    lag_days: lag,
    status: input.status ?? 'not_started',
    notes: clean(input.notes),
  };

  let taskId = input.id ?? 0;
  if (taskId) {
    await updateScheduleTask(taskId, fields);
  } else {
    taskId = await createScheduleTask({ project_id: input.project_id, ...fields });
  }

  if (input.assignees) await setTaskAssignees(taskId, input.assignees);

  revalidateSchedule(input.project_id);
  return { ok: true };
}

export async function deleteTaskAction(id: number): Promise<ActionResult> {
  await requireManager();
  const task = await getScheduleTask(id);
  await deleteScheduleTask(id);
  revalidateSchedule(task?.project_id);
  return { ok: true };
}

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
export async function shiftTaskAction(id: number, days: number): Promise<ActionResult> {
  await requireManager();
  const task = await getScheduleTask(id);
  if (!task) return { ok: false, error: 'That phase no longer exists.' };
  await updateScheduleTask(id, { start_date: addDays(task.start_date, Math.round(days)) });
  revalidateSchedule(task.project_id);
  return { ok: true };
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
 */
export async function sendScheduleAction(
  from: string,
  to: string,
  includeSubs: boolean
): Promise<SendScheduleResult> {
  await requireManager();
  if (!from || !to || to < from) {
    return {
      status: 'error',
      count: 0,
      attempted: 0,
      reason: 'Pick a valid date range.',
      skipped: [],
    };
  }
  return sendScheduleEmails(from, to, includeSubs);
}
