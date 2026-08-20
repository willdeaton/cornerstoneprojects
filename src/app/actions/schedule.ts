'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getProject, updateProject } from '@/lib/data';
import {
  createScheduleTask,
  updateScheduleTask,
  deleteScheduleTask,
  getScheduleTask,
  listScheduleTasks,
  listScheduleChanges,
  listTaskInputs,
  listHolidays,
  listSubcontractors,
  getSubcontractor,
  listAssigneeContacts,
  getPublishedVersion,
  publishSchedule,
  unpublishSchedule,
  logScheduleChange,
  addCrewDay,
  addCrewDays,
  removeCrewDay,
  pruneCrewDays,
  setTaskDayTimes,
  createCrewNote,
  updateCrewNote,
  getCrewNote,
  deleteCrewNote,
  createSubcontractor,
  updateSubcontractor,
  deleteSubcontractor,
  addHoliday,
  deleteHoliday,
  type CrewDayInput,
  type DayTimeInput,
} from '@/lib/schedule-data';
import { sendScheduleEmails, type SendScheduleResult } from '@/lib/email/send';
import {
  addDays,
  computeSchedule,
  crewBudget,
  isValidTime,
  isWorkingDay,
  wouldCycle,
} from '@/lib/schedule-math';
import { shortDate } from '@/lib/format';
import {
  diffTask,
  needsReason,
  summarizeChanges,
  summarizePhase,
  type DiffNames,
  type TaskDraft,
} from '@/lib/schedule-diff';
import type { DependsType, ScheduleChange, TaskDayTime, TaskStatus } from '@/lib/types';

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

/**
 * A start time as stored: 'HH:MM' or null. Anything that isn't a clock time
 * (including the empty string a cleared <input type="time"> submits) is no time
 * at all rather than a validation error the user has to decode.
 */
function cleanTime(v: unknown): string | null {
  const t = clean(v);
  if (t == null) return null;
  // Browsers can hand back 'HH:MM:SS' when seconds are enabled.
  const trimmed = t.length === 8 ? t.slice(0, 5) : t;
  return isValidTime(trimmed) ? trimmed : null;
}

/**
 * The per-day start times as stored: one row per day, latest wins on duplicates,
 * sorted so the change log reads in date order. A day whose time is null keeps
 * its row on purpose — it's how one day opts out of the phase's daily time.
 */
function cleanDayTimes(days: TaskDayTime[] | undefined): DayTimeInput[] {
  if (!days) return [];
  const byDay = new Map<string, string | null>();
  for (const d of days) {
    const day = clean(d.day);
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    byDay.set(day, cleanTime(d.start_time));
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([day, start_time]) => ({ day, start_time }));
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
  /** Our people needed per day. With the duration, the phase's crew budget. */
  crew_size?: number;
  /**
   * The sub doing this phase, or null when it's our own crew's work. A
   * subcontracted phase can still carry a crew_size for the people we send
   * alongside them.
   */
  subcontractor_id?: number | null;
  depends_on_id?: number | null;
  /** Whether the link hangs off the predecessor's finish or its start. */
  depends_type?: DependsType;
  lag_days?: number;
  status?: TaskStatus;
  notes?: string | null;
  /**
   * Why this changed. Required for anything that moves the dates, and — once the
   * job's schedule has been published — for anything that moves work or people
   * (see saveTaskAction).
   */
  reason?: string | null;
}

/**
 * Names for the change log, so a link or a subcontractor reads as a name and
 * not an id. Subs already on the job's phases contribute their own name — the
 * catalog lists only active ones, and a sub since deactivated would otherwise
 * read as `#7`.
 */
async function diffNames(projectId: number): Promise<DiffNames> {
  const [tasks, subs] = await Promise.all([
    listScheduleTasks({ projectId }),
    listSubcontractors(),
  ]);
  const phases = new Map(tasks.map((t) => [t.id, t.name]));
  const subNames = new Map(subs.map((sub) => [sub.id, sub.name]));
  for (const t of tasks) {
    if (t.subcontractor_id != null && t.subcontractor_name && !subNames.has(t.subcontractor_id)) {
      subNames.set(t.subcontractor_id, t.subcontractor_name);
    }
  }
  return {
    phase: (id) => phases.get(id) ?? 'a deleted phase',
    sub: (id) => subNames.get(id) ?? `#${id}`,
  };
}

/**
 * Where a job's phases land, given the whole job's dependency chain. Every
 * crew-staffing check needs this: a phase's window decides both which days can
 * be booked and how big its crew budget is, and neither is stored.
 */
async function jobWindows(projectId: number) {
  const [tasks, holidays] = await Promise.all([listTaskInputs(projectId), listHolidays()]);
  const calendar = { holidays: new Set(holidays.map((h) => h.day)) };
  return { ...computeSchedule(tasks, calendar), calendar };
}

/**
 * Create or update one phase of work: what it is, when it can start, how long
 * it runs, and either how many of our people it needs or which subcontractor
 * covers it.
 *
 * Our own crew is deliberately not named here — they're booked a day at a time
 * from the crew week, where the days are visible. A sub is different: they're
 * contracted for the phase, so they're chosen up front and their days on site
 * follow its dates. A subcontracted phase can still ask for our people
 * alongside them (the supervisor we send), which the crew week books as usual.
 *
 * Rejects a dependency that points at another job or that would close a loop,
 * so the solver in schedule-math never has to untangle one after the fact.
 *
 * Any edit that moves the dates has to carry `reason`, published or not; once
 * the job's schedule is published, so does anything that moves work or people.
 * Either way the reason is logged with a summary of what actually changed, so
 * the job keeps a readable record of every move.
 *
 * A phase that moves or shrinks drops any crew booked on days it no longer
 * covers — a booking outside the window is work nobody is doing.
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

  const subId = input.subcontractor_id ?? null;
  let subName: string | null = null;
  if (subId != null) {
    const sub = await getSubcontractor(subId);
    if (!sub) return { ok: false, error: 'That subcontractor no longer exists.' };
    subName = sub.name;
  }
  // Our own crew on the phase. A subcontracted phase may need none of them, so
  // zero is only allowed when a sub is carrying the work.
  const crewSize =
    subId != null
      ? Math.max(0, Math.round(Number(input.crew_size) || 0))
      : Math.max(1, Math.round(Number(input.crew_size) || 1));

  const fields = {
    name,
    start_date: input.start_date,
    duration_days: duration,
    crew_size: crewSize,
    subcontractor_id: subId,
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
  let summary = summarizePhase({
    name,
    start_date: fields.start_date,
    duration_days: duration,
    crew_size: crewSize,
    subcontractor_name: subName,
  });
  // A brand-new phase moves nothing that was promised, so it only needs
  // explaining once the crew has the schedule.
  let mustExplain = !!published;
  if (before) {
    // Start times and per-day times are set from the crew week, so they come
    // through unchanged here and never show up as a change.
    const draft: TaskDraft = {
      ...fields,
      start_time: before.start_time ?? null,
      day_times: before.day_times ?? [],
    };
    const changes = diffTask(
      {
        name: before.name,
        start_date: before.start_date,
        duration_days: before.duration_days,
        depends_on_id: before.depends_on_id,
        depends_type: before.depends_type ?? 'finish_to_start',
        lag_days: before.lag_days,
        crew_size: before.crew_size,
        subcontractor_id: before.subcontractor_id,
        start_time: before.start_time ?? null,
        day_times: before.day_times ?? [],
        notes: before.notes,
        status: before.status,
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
    mustExplain = needsReason(changes, !!published);
  }

  if (mustExplain && !reason) {
    return {
      ok: false,
      needsReason: true,
      error: published
        ? `This job's schedule was published (v${published.version}). Add a reason for the change.`
        : 'Moving a phase changes the timeline — add a reason so the job records why.',
    };
  }

  let taskId = input.id ?? 0;
  if (taskId) {
    await updateScheduleTask(taskId, fields);
  } else {
    taskId = await createScheduleTask({ project_id: input.project_id, ...fields });
  }

  // Resolved after the write, so the window reflects the edit — and the whole
  // job is re-checked, since a phase that moves takes everything after it along.
  const { windows } = await jobWindows(input.project_id);
  let orphaned = 0;
  for (const [id, window] of windows) orphaned += await pruneCrewDays(id, window);

  // Logged whenever a reason was given, published or not — the history is the
  // job's record of what moved and why, from the first plan onwards.
  if (reason) {
    await logScheduleChange({
      project_id: input.project_id,
      task_id: taskId,
      task_name: name,
      kind: before ? 'updated' : 'added',
      summary: orphaned
        ? `${summary} (${orphaned} crew ${orphaned === 1 ? 'day' : 'days'} dropped off days the work no longer covers)`
        : summary,
      reason,
      version: published?.version ?? null,
      changed_by: me.id,
    });
  }

  revalidateSchedule(input.project_id);
  return { ok: true };
}

/**
 * Remove a phase. Dropping work out of a job moves its timeline, so this always
 * needs a reason — the history has to explain a phase that vanished as much as
 * one that slipped.
 */
export async function deleteTaskAction(id: number, reason?: string | null): Promise<ActionResult> {
  const me = await requireManager();
  const task = await getScheduleTask(id);
  if (!task) return { ok: true };

  const published = await getPublishedVersion(task.project_id);
  const why = clean(reason);
  if (!why) {
    return {
      ok: false,
      needsReason: true,
      error: published
        ? `This job's schedule was published (v${published.version}). Add a reason for removing this phase.`
        : 'Add a reason for removing this phase so the job records why.',
    };
  }

  await deleteScheduleTask(id);

  await logScheduleChange({
    project_id: task.project_id,
    task_id: null,
    task_name: task.name,
    kind: 'deleted',
    summary: `Removed ${summarizePhase(task)}`,
    reason: why,
    version: published?.version ?? null,
    changed_by: me.id,
  });

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
 * moves too, since downstream dates are always derived from this one — which is
 * exactly why the move needs a reason whether or not the schedule went out.
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
  if (!why) {
    return {
      ok: false,
      needsReason: true,
      error: published
        ? `This job's schedule was published (v${published.version}). Add a reason for moving this phase.`
        : 'Moving a phase changes the timeline — add a reason so the job records why.',
    };
  }

  const moved = addDays(task.start_date, Math.round(days));
  await updateScheduleTask(id, { start_date: moved });

  // Everything after it moves too, so the whole job's crew days are re-checked.
  const { windows } = await jobWindows(task.project_id);
  for (const [taskId, window] of windows) await pruneCrewDays(taskId, window);

  await logScheduleChange({
    project_id: task.project_id,
    task_id: task.id,
    task_name: task.name,
    kind: 'updated',
    summary: `Start ${shortDate(task.start_date)} → ${shortDate(moved)}`,
    reason: why,
    version: published?.version ?? null,
    changed_by: me.id,
  });

  revalidateSchedule(task.project_id);
  return { ok: true };
}

/* ------------------------------------------------------------- Crew days */

/** Booking or un-booking one person on one day of a phase. */
export interface CrewDayFields {
  task_id: number;
  day: string;
  kind: 'user' | 'sub';
  /** users.id or subcontractors.id. */
  ref_id: number;
}

/**
 * Book one person onto one day of a phase.
 *
 * The phase's own dates decide what's allowed: the day has to be a working day
 * inside its window, and the phase can only hold crew_size x working-days
 * bookings in total. That budget is spent freely — four people on Monday and
 * one on Friday is a fine way to staff a 2-crew, 5-day phase — so nothing here
 * enforces an even spread; the crew week flags a heavy day and lets it stand.
 *
 * Staffing is not a timeline change and never asks for a reason, published or
 * not: who turns up is exactly what a manager is expected to keep adjusting.
 */
export async function assignCrewDayAction(input: CrewDayFields): Promise<ActionResult> {
  await requireManager();
  const task = await getScheduleTask(input.task_id);
  if (!task) return { ok: false, error: 'That phase no longer exists.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day ?? '')) return { ok: false, error: 'Pick a day.' };

  const { windows, calendar } = await jobWindows(task.project_id);
  const window = windows.get(task.id);
  if (!window) return { ok: false, error: "That phase has no dates to book against." };
  if (input.day < window.start || input.day > window.end) {
    return {
      ok: false,
      error: `${task.name} runs ${shortDate(window.start)} – ${shortDate(window.end)} — that day is outside it.`,
    };
  }
  if (!isWorkingDay(input.day, calendar)) {
    return { ok: false, error: 'That day is a weekend or a non-working day.' };
  }

  if (input.kind === 'sub' && task.subcontractor_id === input.ref_id) {
    return {
      ok: false,
      error: `${task.subcontractor_name ?? 'That subcontractor'} already has this phase — they're on site every day of it.`,
    };
  }

  const budget = crewBudget(task, window, calendar);
  const res = await addCrewDay(
    task.id,
    { day: input.day, kind: input.kind, ref_id: input.ref_id },
    budget.capacity
  );
  if (!res.ok) {
    return res.reason === 'full'
      ? {
          ok: false,
          error: `${task.name} is fully staffed — ${budget.capacity} crew ${
            budget.capacity === 1 ? 'day' : 'days'
          } for ${budget.needed} ${budget.needed === 1 ? 'person' : 'people'} over ${budget.days} working ${
            budget.days === 1 ? 'day' : 'days'
          }. Raise the crew it needs on the timeline, or take someone off another day.`,
        }
      : { ok: false, error: 'They are already booked on this phase that day.' };
  }

  revalidateSchedule(task.project_id);
  return { ok: true };
}

/** Booking one person across several days of a phase at once. */
export interface CrewSpanFields {
  task_id: number;
  /** The days to book; anything outside the phase or non-working is dropped. */
  days: string[];
  kind: 'user' | 'sub';
  ref_id: number;
}

/**
 * Book one person onto every given day of a phase — what dropping a job card on
 * somebody's name in the crew week means: "they're on this, for the days of it
 * that are on screen."
 *
 * The phase's own rules still decide what lands: days outside its window or on a
 * weekend are dropped before anything is written, and the crew-day budget stops
 * the rest. A partial fill is a success, not an error — the message says how far
 * it got so the manager can spread the remainder themselves.
 */
export async function assignCrewSpanAction(input: CrewSpanFields): Promise<ActionResult> {
  await requireManager();
  const task = await getScheduleTask(input.task_id);
  if (!task) return { ok: false, error: 'That phase no longer exists.' };

  const { windows, calendar } = await jobWindows(task.project_id);
  const window = windows.get(task.id);
  if (!window) return { ok: false, error: 'That phase has no dates to book against.' };

  const days = [...new Set(input.days ?? [])]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter((d) => d >= window.start && d <= window.end && isWorkingDay(d, calendar))
    .sort();
  if (days.length === 0) {
    return {
      ok: false,
      error: `${task.name} runs ${shortDate(window.start)} – ${shortDate(window.end)} — none of those days are on it.`,
    };
  }

  const budget = crewBudget(task, window, calendar);
  const res = await addCrewDays(task.id, days, { kind: input.kind, ref_id: input.ref_id }, budget.capacity);
  revalidateSchedule(task.project_id);

  if (res.booked === 0 && res.full) {
    return {
      ok: false,
      error: `${task.name} is fully staffed — ${budget.capacity} crew ${
        budget.capacity === 1 ? 'day' : 'days'
      } planned. Take someone off a day, or raise the crew it needs on the timeline.`,
    };
  }
  if (res.booked === 0) return { ok: false, error: 'They were already on every one of those days.' };
  return { ok: true };
}

/** Take one person off one day of a phase. */
export async function unassignCrewDayAction(input: CrewDayFields): Promise<ActionResult> {
  await requireManager();
  const task = await getScheduleTask(input.task_id);
  if (!task) return { ok: true };
  await removeCrewDay(task.id, { day: input.day, kind: input.kind, ref_id: input.ref_id });
  revalidateSchedule(task.project_id);
  return { ok: true };
}

/* -------------------------------------------------------- Crew job cards */

/**
 * The crew-facing half of a phase, saved from its job card in the crew week:
 * what time the crew starts, any day that starts at a different time, and the
 * notes they read before they turn up.
 *
 * These live here rather than on the timeline because they only make sense with
 * the days in front of you — a 6 AM delivery belongs to a Tuesday, not to a bar
 * on a Gantt chart. Once the schedule has gone out to the crew, changing any of
 * it needs a reason, the same as moving work does.
 */
export interface CrewCardFields {
  task_id: number;
  /** Daily start time as 'HH:MM'; null or '' for the crew's normal hours. */
  start_time?: string | null;
  /** Per-day start-time overrides, replacing whatever the phase had. */
  day_times?: TaskDayTime[];
  /** What the crew should know about this job — shown on their own schedule. */
  notes?: string | null;
  reason?: string | null;
}

export async function saveCrewCardAction(input: CrewCardFields): Promise<ActionResult> {
  const me = await requireManager();
  const task = await getScheduleTask(input.task_id);
  if (!task) return { ok: false, error: 'That phase no longer exists.' };

  const startTime = cleanTime(input.start_time);
  const dayTimes = cleanDayTimes(input.day_times);
  const notes = clean(input.notes);

  const before: TaskDraft = {
    name: task.name,
    start_date: task.start_date,
    duration_days: task.duration_days,
    depends_on_id: task.depends_on_id,
    depends_type: task.depends_type ?? 'finish_to_start',
    lag_days: task.lag_days,
    crew_size: task.crew_size,
    subcontractor_id: task.subcontractor_id,
    start_time: task.start_time ?? null,
    day_times: task.day_times ?? [],
    notes: task.notes,
    status: task.status,
  };
  const changes = diffTask(
    before,
    { ...before, start_time: startTime, day_times: dayTimes, notes },
    await diffNames(task.project_id)
  );
  if (changes.length === 0) return { ok: true };

  const published = await getPublishedVersion(task.project_id);
  const reason = clean(input.reason);
  if (needsReason(changes, !!published) && !reason) {
    return {
      ok: false,
      needsReason: true,
      error: `This job's schedule was published (v${published?.version}). Add a reason for the change.`,
    };
  }

  await updateScheduleTask(task.id, { start_time: startTime, notes });
  await setTaskDayTimes(task.id, dayTimes);

  if (reason) {
    await logScheduleChange({
      project_id: task.project_id,
      task_id: task.id,
      task_name: task.name,
      kind: 'updated',
      summary: summarizeChanges(changes),
      reason,
      version: published?.version ?? null,
      changed_by: me.id,
    });
  }

  revalidateSchedule(task.project_id);
  return { ok: true };
}

/* --------------------------------------------------------- Hard finish date */

/**
 * Set (or clear) the date a job absolutely has to be finished by. Moving a date
 * that was already promised needs a reason and is logged with the phase history,
 * since a hard finish moving is the biggest timeline change a job can have.
 * Setting one for the first time, or clearing it, doesn't.
 */
export async function setHardFinishDateAction(
  projectId: number,
  date: string | null,
  reason?: string | null
): Promise<ActionResult> {
  const me = await requireManager();
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: 'That job no longer exists.' };

  const next = clean(date);
  if (next != null && !/^\d{4}-\d{2}-\d{2}$/.test(next)) {
    return { ok: false, error: 'Pick a valid date.' };
  }
  const current = project.hard_finish_date ?? null;
  if (next === current) return { ok: true };

  const why = clean(reason);
  // Only a date that was already set counts as a move.
  if (current != null && next != null && !why) {
    return {
      ok: false,
      needsReason: true,
      error: 'This job already has a hard finish date — add a reason for moving it.',
    };
  }

  await updateProject(projectId, { hard_finish_date: next });

  if (why || current != null) {
    const published = await getPublishedVersion(projectId);
    await logScheduleChange({
      project_id: projectId,
      task_id: null,
      task_name: null,
      kind: 'job',
      summary:
        next == null
          ? `Hard finish date removed (was ${shortDate(current)})`
          : `Hard finish date ${current == null ? 'set to' : `${shortDate(current)} →`} ${shortDate(next)}`,
      reason: why ?? 'No reason given',
      version: published?.version ?? null,
      changed_by: me.id,
    });
  }

  revalidateSchedule(projectId);
  return { ok: true };
}

/* --------------------------------------------------------------- Crew notes */

/**
 * Post or edit a note for the crew on this job — gate codes, parking, who to
 * ask for on site. Everyone booked on the job sees these on their own schedule,
 * so they're managers-only to write and never mixed in with internal job notes.
 */
export async function saveCrewNoteAction(input: {
  id?: number;
  project_id: number;
  body: string;
  pinned?: boolean;
}): Promise<ActionResult> {
  const me = await requireManager();
  const body = (input.body ?? '').trim();
  if (!body) return { ok: false, error: 'Write something for the crew first.' };
  if (!input.project_id) return { ok: false, error: 'Pick a job for this note.' };

  if (input.id) {
    const existing = await getCrewNote(input.id);
    if (!existing) return { ok: false, error: 'That note no longer exists.' };
    await updateCrewNote(input.id, { body, pinned: input.pinned ?? existing.pinned });
  } else {
    await createCrewNote({
      project_id: input.project_id,
      body,
      pinned: input.pinned ?? false,
      author_id: me.id,
      author_name: me.name,
    });
  }

  revalidateSchedule(input.project_id);
  return { ok: true };
}

export async function deleteCrewNoteAction(id: number): Promise<ActionResult> {
  await requireManager();
  const note = await getCrewNote(id);
  if (!note) return { ok: true };
  await deleteCrewNote(id);
  revalidateSchedule(note.project_id);
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
