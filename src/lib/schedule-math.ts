/*
 * ============================================================================
 *  SCHEDULE MATH
 *
 *  The one place the scheduling date rules live. Everything here is pure — no
 *  database, no `server-only` — so the same functions drive the server-rendered
 *  timeline and the live preview inside the phase editor.
 *
 *  Dates are plain 'YYYY-MM-DD' strings throughout, matching how Postgres DATE
 *  columns arrive (see the type parser in ./db.ts). Deliberately no Date-with-
 *  timezone arithmetic: a calendar day is a calendar day.
 * ============================================================================
 */

import type { ScheduleTaskRow } from './types';

/** Days the crew doesn't work: weekends always, plus any listed holidays. */
export interface WorkCalendar {
  /** 'YYYY-MM-DD' days treated as non-working. */
  holidays: Set<string>;
}

export const EMPTY_CALENDAR: WorkCalendar = { holidays: new Set() };

/* ------------------------------------------------------- Day-string helpers */

/** Today as 'YYYY-MM-DD' in the viewer's local timezone. */
export function today(): string {
  return toDay(new Date());
}

/** A Date -> 'YYYY-MM-DD' using local calendar fields (never UTC-shifted). */
export function toDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 'YYYY-MM-DD' -> Date at local midnight. */
export function fromDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Shift a day by whole calendar days (negative goes backwards). */
export function addDays(day: string, n: number): string {
  const d = fromDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

/** Calendar days from `a` to `b` inclusive of both ends (1 when equal). */
export function calendarSpan(a: string, b: string): number {
  const ms = fromDay(b).getTime() - fromDay(a).getTime();
  return Math.floor(ms / 86400000) + 1;
}

/** Every day from `from` to `to` inclusive. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** True when two inclusive date ranges share at least one day. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/* --------------------------------------------------------- Working-day math */

/** Saturday or Sunday. */
export function isWeekend(day: string): boolean {
  const dow = fromDay(day).getDay();
  return dow === 0 || dow === 6;
}

export function isWorkingDay(day: string, cal: WorkCalendar): boolean {
  return !isWeekend(day) && !cal.holidays.has(day);
}

/** `day` itself if it's a working day, else the next one that is. */
export function nextWorkingDay(day: string, cal: WorkCalendar): string {
  let d = day;
  // Bounded so a pathological holiday list can't spin forever.
  for (let i = 0; i < 400 && !isWorkingDay(d, cal); i++) d = addDays(d, 1);
  return d;
}

/**
 * Advance `n` working days past the working day at/after `start`. n = 0 returns
 * that first working day, so a 1-day phase starting Friday ends Friday and a
 * 2-day one ends the following Monday.
 */
export function addWorkingDays(start: string, n: number, cal: WorkCalendar): string {
  let d = nextWorkingDay(start, cal);
  let left = Math.max(0, n);
  while (left > 0) {
    d = nextWorkingDay(addDays(d, 1), cal);
    left--;
  }
  return d;
}

/** Count of working days in the inclusive range `start`..`end`. */
export function workingDaySpan(start: string, end: string, cal: WorkCalendar): number {
  if (end < start) return 0;
  let count = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (isWorkingDay(d, cal)) count++;
  }
  return count;
}

/* ------------------------------------------------------- Dependency solving */

/** The fields computeSchedule needs from a phase. */
export interface TaskInput {
  id: number;
  project_id: number;
  start_date: string;
  duration_days: number;
  depends_on_id: number | null;
  lag_days: number;
}

export interface ComputedWindow {
  start: string;
  end: string;
  /** True when a predecessor pushed this phase past its own earliest start. */
  driven: boolean;
}

export interface ComputedSchedule {
  windows: Map<number, ComputedWindow>;
  /** Ids of phases caught in a dependency cycle (scheduled from their own start). */
  cycles: number[];
}

/**
 * Resolve every phase's real window from the dependency chain:
 *
 *   start = max(own earliest start, first working day after predecessor + lag)
 *   end   = start advanced by (duration - 1) working days
 *
 * Memoized depth-first resolution — each phase has at most one predecessor, so
 * a chain resolves in one pass. A phase re-entered while still resolving is in
 * a cycle: it falls back to its own start_date and is reported in `cycles`
 * rather than looping forever.
 */
export function computeSchedule(tasks: TaskInput[], cal: WorkCalendar): ComputedSchedule {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const windows = new Map<number, ComputedWindow>();
  const cycles: number[] = [];
  const resolving = new Set<number>();

  function resolve(task: TaskInput): ComputedWindow {
    const done = windows.get(task.id);
    if (done) return done;

    let earliest = nextWorkingDay(task.start_date, cal);
    let driven = false;

    if (task.depends_on_id != null && task.depends_on_id !== task.id) {
      const pred = byId.get(task.depends_on_id);
      if (pred) {
        if (resolving.has(pred.id)) {
          // Cycle: stop unwinding here and let this phase stand on its own.
          if (!cycles.includes(task.id)) cycles.push(task.id);
        } else {
          resolving.add(task.id);
          const predWindow = resolve(pred);
          resolving.delete(task.id);
          const after = addWorkingDays(addDays(predWindow.end, 1), task.lag_days, cal);
          if (after > earliest) {
            earliest = after;
            driven = true;
          }
        }
      }
    }

    const resolved: ComputedWindow = {
      start: earliest,
      end: addWorkingDays(earliest, Math.max(1, task.duration_days) - 1, cal),
      driven,
    };
    windows.set(task.id, resolved);
    return resolved;
  }

  for (const t of tasks) resolve(t);
  return { windows, cycles };
}

/**
 * Would linking `taskId` to `dependsOnId` create a cycle? Walks the existing
 * chain upward from the proposed predecessor looking for the task itself.
 */
export function wouldCycle(
  tasks: TaskInput[],
  taskId: number,
  dependsOnId: number | null
): boolean {
  if (dependsOnId == null) return false;
  if (dependsOnId === taskId) return true;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<number>();
  let at: number | null = dependsOnId;
  while (at != null && !seen.has(at)) {
    if (at === taskId) return true;
    seen.add(at);
    at = byId.get(at)?.depends_on_id ?? null;
  }
  return false;
}

/** The latest end date across the given phases, or null when there are none. */
export function projectedEnd(
  taskIds: number[],
  windows: Map<number, ComputedWindow>
): string | null {
  let latest: string | null = null;
  for (const id of taskIds) {
    const w = windows.get(id);
    if (w && (latest == null || w.end > latest)) latest = w.end;
  }
  return latest;
}

/* ------------------------------------------------------------- Conflicts */

/** One booked window for one assignee, flattened across all jobs. */
export interface AssigneeWindow {
  /** 'user:4' / 'sub:2' — the identity conflicts are grouped by. */
  key: string;
  name: string;
  taskId: number;
  taskName: string;
  projectId: number;
  projectName: string;
  start: string;
  end: string;
}

/** Flatten phases into one booking per assignee, over the phase's window. */
export function assigneeWindows(
  tasks: ScheduleTaskRow[],
  windows: Map<number, ComputedWindow>
): AssigneeWindow[] {
  const out: AssigneeWindow[] = [];
  for (const task of tasks) {
    const w = windows.get(task.id);
    if (!w) continue;
    for (const a of task.assignees ?? []) {
      out.push({
        key: `${a.kind}:${a.ref_id}`,
        name: a.name,
        taskId: task.id,
        taskName: task.name,
        projectId: task.project_id,
        projectName: task.project_name,
        start: w.start,
        end: w.end,
      });
    }
  }
  return out;
}

/** Two bookings for the same assignee that overlap in time. */
export interface Conflict {
  key: string;
  name: string;
  /** The overlapping stretch (the days actually double-booked). */
  start: string;
  end: string;
  a: AssigneeWindow;
  b: AssigneeWindow;
}

/**
 * Every pair of overlapping bookings per assignee. Two phases on the SAME job
 * are allowed to overlap (a crew can run two phases of one job), so only
 * cross-job overlaps count as conflicts.
 */
export function findConflicts(windows: AssigneeWindow[]): Conflict[] {
  const byKey = new Map<string, AssigneeWindow[]>();
  for (const w of windows) {
    const list = byKey.get(w.key);
    if (list) list.push(w);
    else byKey.set(w.key, [w]);
  }

  const out: Conflict[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        // Sorted by start, so once b starts after a ends nothing later overlaps a.
        if (b.start > a.end) break;
        if (a.projectId === b.projectId) continue;
        if (!rangesOverlap(a.start, a.end, b.start, b.end)) continue;
        out.push({
          key,
          name: a.name,
          start: a.start > b.start ? a.start : b.start,
          end: a.end < b.end ? a.end : b.end,
          a,
          b,
        });
      }
    }
  }
  return out;
}

/** Task ids involved in at least one conflict — for outlining bars. */
export function conflictedTaskIds(conflicts: Conflict[]): Set<number> {
  const out = new Set<number>();
  for (const c of conflicts) {
    out.add(c.a.taskId);
    out.add(c.b.taskId);
  }
  return out;
}
