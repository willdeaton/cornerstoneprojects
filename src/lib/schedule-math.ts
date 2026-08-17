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

import type { DependsType, ScheduleTaskRow, TaskStatus } from './types';

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

/* ------------------------------------------------------ Day-of-week masks */

/**
 * Which weekdays someone works a phase, as a 7-bit mask indexed by
 * Date#getDay() — bit 0 Sunday … bit 6 Saturday. A null mask means "every
 * working day of the window", which is what everyone gets until a split-day
 * pattern is set. Weekends and holidays are still excluded either way: the
 * mask narrows the working days, it never adds one back.
 */
export const DAY_MASK_ALL = 0b1111111;
/** Mon–Fri — the mask the split-day editor opens on. */
export const DAY_MASK_WEEKDAYS = 0b0111110;

/** Short labels indexed the same way as the mask bits. */
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
/** Single letters for the compact day toggles. */
export const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/**
 * The canonical form of a mask: 1..126, or null for "every working day". An
 * empty mask would book nobody and a full week means the same thing as null, so
 * both collapse — the editor, the action and the column all agree on this.
 */
export function normalizeMask(mask: number | null | undefined): number | null {
  if (mask == null) return null;
  const m = Math.round(mask) & DAY_MASK_ALL;
  return m === 0 || m === DAY_MASK_ALL ? null : m;
}

export function maskHasDow(mask: number | null, dow: number): boolean {
  return mask == null || (mask & (1 << dow)) !== 0;
}

export function maskFromDows(dows: number[]): number {
  return dows.reduce((m, d) => m | (1 << d), 0);
}

export function toggleDow(mask: number, dow: number): number {
  return mask ^ (1 << dow);
}

/** The days a mask names, ascending — [1,3] for a Mon/Wed pattern. */
export function maskDows(mask: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < 7; d++) if ((mask & (1 << d)) !== 0) out.push(d);
  return out;
}

/**
 * True when this mask actually splits the week — i.e. it leaves out a weekday
 * someone would otherwise work. A full week or plain Mon–Fri isn't a split, so
 * the UI stays quiet for the normal case.
 */
export function isSplitPattern(mask: number | null): boolean {
  if (mask == null) return false;
  return (mask & DAY_MASK_WEEKDAYS) !== DAY_MASK_WEEKDAYS;
}

/** "Mon, Wed" — the working weekdays a mask covers, for labels and emails. */
export function maskLabel(mask: number | null): string {
  if (mask == null) return 'Every working day';
  const days = maskDows(mask);
  if (days.length === 0) return 'No days';
  return days.map((d) => DAY_LABELS[d]).join(', ');
}

/** A day this person works: a working day the mask also allows. */
export function worksDay(day: string, mask: number | null, cal: WorkCalendar): boolean {
  return isWorkingDay(day, cal) && maskHasDow(mask, fromDay(day).getDay());
}

/* --------------------------------------------------------- Day segments */

/** A run of consecutive calendar days actually worked. */
export interface DaySegment {
  start: string;
  end: string;
}

/**
 * Split an inclusive window into the stretches actually worked, breaking at
 * every non-working day and at any day the mask leaves out.
 *
 * This is what keeps a Mon–Fri phase from looking like it runs through the
 * weekend: a two-week phase comes back as two segments, one per week, with the
 * weekend showing as a gap. A Mon/Wed pattern comes back as one segment per
 * day.
 */
export function workedSegments(
  start: string,
  end: string,
  cal: WorkCalendar,
  mask: number | null = null
): DaySegment[] {
  const out: DaySegment[] = [];
  if (end < start) return out;
  let open: DaySegment | null = null;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (worksDay(d, mask, cal)) {
      if (open && open.end === addDays(d, -1)) open.end = d;
      else {
        open = { start: d, end: d };
        out.push(open);
      }
    } else {
      open = null;
    }
  }
  return out;
}

/* ------------------------------------------------------- Dependency solving */

/** The fields computeSchedule needs from a phase. */
export interface TaskInput {
  id: number;
  project_id: number;
  start_date: string;
  duration_days: number;
  depends_on_id: number | null;
  /** Defaults to 'finish_to_start' when absent. */
  depends_type?: DependsType | null;
  lag_days: number;
}

export interface ComputedWindow {
  start: string;
  end: string;
  /** True when a predecessor pushed this phase past its own earliest start. */
  driven: boolean;
}

/**
 * Where a link's lag is measured from. Finish-to-start counts working days
 * after the day the predecessor ends; start-to-start counts them from the day
 * it begins, so lag 0 means "same day" and the two phases overlap.
 */
function linkedStart(
  pred: ComputedWindow,
  type: DependsType,
  lagDays: number,
  cal: WorkCalendar
): string {
  if (type === 'start_to_start') return addWorkingDays(pred.start, lagDays, cal);
  return addWorkingDays(addDays(pred.end, 1), lagDays, cal);
}

export interface ComputedSchedule {
  windows: Map<number, ComputedWindow>;
  /** Ids of phases caught in a dependency cycle (scheduled from their own start). */
  cycles: number[];
}

/**
 * Resolve every phase's real window from the dependency chain:
 *
 *   start = max(own earliest start, anchor + lag)
 *   end   = start advanced by (duration - 1) working days
 *
 * where the anchor is the first working day after the predecessor ends
 * (finish-to-start) or the day it begins (start-to-start).
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
          const after = linkedStart(
            predWindow,
            task.depends_type ?? 'finish_to_start',
            task.lag_days,
            cal
          );
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

/* ------------------------------------------------------------- Bookings */

/**
 * One stretch of days a single assignee actually works, on one phase. A phase
 * is flattened into one of these per person per unbroken run of worked days,
 * so weekends, holidays and split-day patterns all show up as gaps rather than
 * being papered over by the phase's outer window.
 */
export interface AssigneeBooking {
  /** 'user:4' / 'sub:2' — the identity bookings are grouped by. */
  key: string;
  kind: 'user' | 'sub';
  refId: number;
  name: string;
  /** Role for employees, trade for subs. */
  detail: string | null;
  /** This person's day pattern on the phase (null = every working day). */
  workDays: number | null;
  taskId: number;
  taskName: string;
  taskStatus: TaskStatus;
  taskNotes: string | null;
  projectId: number;
  projectName: string;
  customer: string;
  location: string | null;
  /** The phase's whole window, for context. */
  windowStart: string;
  windowEnd: string;
  /** The worked stretch itself — every day between these IS worked. */
  start: string;
  end: string;
}

/**
 * Flatten phases into per-assignee worked stretches. Pass the same calendar the
 * windows were computed with.
 */
export function assigneeBookings(
  tasks: ScheduleTaskRow[],
  windows: Map<number, ComputedWindow>,
  cal: WorkCalendar
): AssigneeBooking[] {
  const out: AssigneeBooking[] = [];
  for (const task of tasks) {
    const w = windows.get(task.id);
    if (!w) continue;
    for (const a of task.assignees ?? []) {
      for (const seg of workedSegments(w.start, w.end, cal, a.work_days)) {
        out.push({
          key: `${a.kind}:${a.ref_id}`,
          kind: a.kind,
          refId: a.ref_id,
          name: a.name,
          detail: a.detail,
          workDays: a.work_days,
          taskId: task.id,
          taskName: task.name,
          taskStatus: task.status,
          taskNotes: task.notes,
          projectId: task.project_id,
          projectName: task.project_name,
          customer: task.customer,
          location: task.location,
          windowStart: w.start,
          windowEnd: w.end,
          start: seg.start,
          end: seg.end,
        });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------- Conflicts */

/** Two bookings for the same assignee that land on the same days. */
export interface Conflict {
  key: string;
  name: string;
  /** The overlapping stretch (the days actually double-booked). */
  start: string;
  end: string;
  a: AssigneeBooking;
  b: AssigneeBooking;
}

/**
 * Every pair of overlapping bookings per assignee. Because bookings are the
 * days actually worked, someone running one job Mon/Wed and another Tuesday is
 * NOT a conflict — only genuinely shared days are. Two phases on the SAME job
 * are allowed to overlap (a crew can run two phases of one job), so only
 * cross-job overlaps count.
 */
export function findConflicts(windows: AssigneeBooking[]): Conflict[] {
  const byKey = new Map<string, AssigneeBooking[]>();
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

/* ------------------------------------------------------------ Week views */

/** Monday of the week containing `day`. */
export function weekStart(day: string): string {
  const dow = fromDay(day).getDay();
  // getDay() is 0 for Sunday, which belongs to the week that began 6 days back.
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

/**
 * A week as "Aug 17 – 23, 2026", or "Aug 31 – Sep 6, 2026" when it straddles
 * two months. Composed by hand rather than by format options, which have no
 * combination for "day and year without the month".
 */
export function weekLabel(monday: string): string {
  const a = fromDay(monday);
  const b = fromDay(addDays(monday, 6));
  const left = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const right =
    a.getMonth() === b.getMonth()
      ? String(b.getDate())
      : b.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${left} – ${right}, ${b.getFullYear()}`;
}

/**
 * Bookings indexed person -> day -> what they're on that day. Every day inside
 * a booking is a day actually worked, so a lookup miss means "nothing booked",
 * which is exactly what the crew week grid needs to show someone free.
 */
export function bookingsByDay(
  bookings: AssigneeBooking[]
): Map<string, Map<string, AssigneeBooking[]>> {
  const out = new Map<string, Map<string, AssigneeBooking[]>>();
  for (const b of bookings) {
    let byDay = out.get(b.key);
    if (!byDay) {
      byDay = new Map();
      out.set(b.key, byDay);
    }
    for (const day of eachDay(b.start, b.end)) {
      const list = byDay.get(day);
      if (list) list.push(b);
      else byDay.set(day, [b]);
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
