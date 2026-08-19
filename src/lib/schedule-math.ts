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

import type { CrewDay, DependsType, ScheduleTaskRow, TaskStatus } from './types';

/** Days the crew doesn't work: weekends always, plus any listed holidays. */
export interface WorkCalendar {
  /** 'YYYY-MM-DD' days treated as non-working. */
  holidays: Set<string>;
}

export const EMPTY_CALENDAR: WorkCalendar = { holidays: new Set() };

/* ------------------------------------------------------- Day-string helpers */

/** Short weekday labels indexed by Date#getDay() — 0 is Sunday. */
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

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

/* ------------------------------------------------------------- Time of day */

/**
 * A start time is plain 'HH:MM' text, 24-hour — the same "a clock time is a
 * clock time" treatment dates get here, with no timezone attached.
 */
export function isValidTime(time: string): boolean {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time);
}

/** 'HH:MM' -> "7:00 AM"; anything unparseable comes back as given. */
export function timeLabel(time: string | null | undefined): string {
  if (!time || !isValidTime(time)) return time ?? '';
  const [h, m] = time.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** A phase's per-day start-time overrides, as the solver wants them. */
export type DayTimes = Map<string, string | null>;

/** Overrides keyed by day. An entry set to null clears the time for that day. */
export function dayTimeMap(rows: { day: string; start_time: string | null }[] = []): DayTimes {
  return new Map(rows.map((r) => [r.day, r.start_time]));
}

/**
 * What time work starts on one day of a phase: the day's own override if it has
 * one (including an override that clears the time), otherwise the phase's daily
 * start time.
 */
export function startTimeOn(
  day: string,
  phaseTime: string | null | undefined,
  overrides?: DayTimes
): string | null {
  if (overrides?.has(day)) return overrides.get(day) ?? null;
  return phaseTime ?? null;
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

/* --------------------------------------------------------- Day segments */

/** A run of consecutive calendar days actually worked. */
export interface DaySegment {
  start: string;
  end: string;
}

/**
 * Split an inclusive window into the stretches actually worked, breaking at
 * every non-working day.
 *
 * This is what keeps a Mon–Fri phase from looking like it runs through the
 * weekend: a two-week phase comes back as two segments, one per week, with the
 * weekend showing as a gap.
 */
export function workedSegments(start: string, end: string, cal: WorkCalendar): DaySegment[] {
  return mergeDays(eachDay(start, end).filter((d) => isWorkingDay(d, cal)));
}

/**
 * Merge sorted days into runs of consecutive calendar days. A gap of any size —
 * a weekend, a holiday, a day simply not booked — starts a new run, which is
 * how a split week reads as the days it really is.
 */
export function mergeDays(days: string[]): DaySegment[] {
  const out: DaySegment[] = [];
  for (const day of days) {
    const open = out[out.length - 1];
    if (open && addDays(open.end, 1) === day) open.end = day;
    else out.push({ start: day, end: day });
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

/* --------------------------------------------------------- Crew budgeting */

/**
 * What a phase asks for and what it has got.
 *
 * The timeline plans the ask — `crew_size` people for `duration_days` working
 * days — which is a budget of that many crew-days. The crew week spends it a
 * day at a time, and deliberately not evenly: four people on Monday and one on
 * Friday is a perfectly good way to spend a 2-crew, 5-day phase, and the week
 * usually does fall that way. So the budget is enforced as a total, and a day
 * carrying more people than `crew_size` is worth pointing out but never wrong.
 */
export interface CrewBudget {
  /** People per day the phase was planned for. */
  needed: number;
  /** Working days in the phase's window. */
  days: number;
  /** needed x days — every crew-day this phase may be staffed with. */
  capacity: number;
  /** Crew-days actually booked. */
  filled: number;
  /** What's left to book (never negative). */
  remaining: number;
  /** True when nothing more can be booked onto this phase. */
  full: boolean;
}

export function crewBudget(
  task: Pick<ScheduleTaskRow, 'crew_size' | 'crew_days'>,
  window: ComputedWindow | undefined,
  cal: WorkCalendar
): CrewBudget {
  const needed = Math.max(1, task.crew_size);
  const days = window ? workingDaySpan(window.start, window.end, cal) : 0;
  const capacity = needed * days;
  const filled = (task.crew_days ?? []).length;
  return {
    needed,
    days,
    capacity,
    filled,
    remaining: Math.max(0, capacity - filled),
    full: filled >= capacity,
  };
}

/** A phase's crew indexed by day — what the crew week reads off a job card. */
export function crewByDay(task: Pick<ScheduleTaskRow, 'crew_days'>): Map<string, CrewDay[]> {
  const out = new Map<string, CrewDay[]>();
  for (const c of task.crew_days ?? []) {
    const list = out.get(c.day);
    if (list) list.push(c);
    else out.set(c.day, [c]);
  }
  return out;
}

/** Everyone booked on a phase at all, with how many days each of them has. */
export function crewRoster(
  task: Pick<ScheduleTaskRow, 'crew_days'>
): { key: string; kind: 'user' | 'sub'; refId: number; name: string; days: number }[] {
  const out = new Map<string, { key: string; kind: 'user' | 'sub'; refId: number; name: string; days: number }>();
  for (const c of task.crew_days ?? []) {
    const key = `${c.kind}:${c.ref_id}`;
    const entry = out.get(key);
    if (entry) entry.days++;
    else out.set(key, { key, kind: c.kind, refId: c.ref_id, name: c.name, days: 1 });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------- Bookings */

/**
 * One stretch of days a single person actually works, on one phase. Built from
 * the crew-day rows themselves, so a week booked Mon/Wed comes back as two
 * one-day stretches rather than one bar drawn through a Tuesday nobody is
 * there — the crew views and the schedule emails both need that to be true.
 */
export interface AssigneeBooking {
  /** 'user:4' / 'sub:2' — the identity bookings are grouped by. */
  key: string;
  kind: 'user' | 'sub';
  refId: number;
  name: string;
  /** Role for employees, trade for subs. */
  detail: string | null;
  taskId: number;
  taskName: string;
  taskStatus: TaskStatus;
  taskNotes: string | null;
  projectId: number;
  projectName: string;
  customer: string;
  location: string | null;
  /** The job's full site address, for the crew views and emails. */
  siteAddress: string | null;
  /**
   * What time work starts on every day of this stretch. A stretch breaks
   * wherever the time changes, so one booking always means one start time.
   */
  startTime: string | null;
  /** The phase's whole window, for context. */
  windowStart: string;
  windowEnd: string;
  /** The worked stretch itself — every day between these IS worked. */
  start: string;
  end: string;
}

/**
 * Flatten phases into per-person worked stretches. Pass the same calendar the
 * windows were computed with; days booked outside a phase's window (left behind
 * by a phase that has since moved or shrunk) are dropped rather than shown.
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
    const overrides = dayTimeMap(task.day_times ?? []);

    // Group the phase's crew-day rows by person, then merge each person's days
    // into runs — one booking per unbroken stretch, per start time.
    const byPerson = new Map<string, { person: CrewDay; days: string[] }>();
    for (const c of task.crew_days ?? []) {
      if (c.day < w.start || c.day > w.end || !isWorkingDay(c.day, cal)) continue;
      const key = `${c.kind}:${c.ref_id}`;
      const entry = byPerson.get(key);
      if (entry) entry.days.push(c.day);
      else byPerson.set(key, { person: c, days: [c.day] });
    }

    for (const [key, { person, days }] of byPerson) {
      const sorted = [...days].sort();
      for (const seg of mergeDays(sorted)) {
        // A day that starts at a different time is its own stretch, so every
        // booking carries exactly one start time and the crew views never have
        // to say "7 AM (except Wednesday)".
        for (const run of splitByStartTime(seg, task.start_time, overrides)) {
          out.push({
            key,
            kind: person.kind,
            refId: person.ref_id,
            name: person.name,
            detail: person.detail,
            taskId: task.id,
            taskName: task.name,
            taskStatus: task.status,
            taskNotes: task.notes,
            projectId: task.project_id,
            projectName: task.project_name,
            customer: task.customer,
            location: task.location,
            siteAddress: task.site_address ?? null,
            startTime: run.startTime,
            windowStart: w.start,
            windowEnd: w.end,
            start: run.start,
            end: run.end,
          });
        }
      }
    }
  }
  return out;
}

/** Break one worked stretch wherever its start time changes. */
function splitByStartTime(
  seg: DaySegment,
  phaseTime: string | null | undefined,
  overrides: DayTimes
): (DaySegment & { startTime: string | null })[] {
  const out: (DaySegment & { startTime: string | null })[] = [];
  for (const day of eachDay(seg.start, seg.end)) {
    const startTime = startTimeOn(day, phaseTime, overrides);
    const open = out[out.length - 1];
    if (open && open.startTime === startTime) open.end = day;
    else out.push({ start: day, end: day, startTime });
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
 * Every pair of overlapping bookings per person. Because bookings are the days
 * actually booked, someone running one job Mon/Wed and another Tuesday is NOT a
 * conflict — only genuinely shared days are. Two phases on the SAME job are
 * allowed to overlap (a crew can run two phases of one job), so only cross-job
 * overlaps count.
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

/** "Aug 17" — a single day for a week band or range heading. */
export function mondayLabel(day: string): string {
  return fromDay(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * A multi-week range as "Aug 17 – Aug 30, 2026" — what a fortnight of crew week
 * is headed with. A single week reads better as `weekLabel`, which drops the
 * repeated month.
 */
export function rangeLabel(from: string, to: string): string {
  return `${mondayLabel(from)} – ${mondayLabel(to)}, ${fromDay(to).getFullYear()}`;
}

/**
 * The Monday-anchored range of `spanDays` days that contains `day`.
 *
 * Multi-week views always start on a Monday and run to the Sunday that ends the
 * last week, so a fortnight is two whole weeks rather than a fortnight of
 * half-weeks — the crew reads the schedule a week at a time, and a column
 * headed Wednesday at the far left makes that impossible.
 */
export function weekAlignedRange(day: string, spanDays: number): { start: string; end: string } {
  const start = weekStart(day);
  const weeks = Math.max(1, Math.ceil(spanDays / 7));
  return { start, end: addDays(start, weeks * 7 - 1) };
}

/** One entry per week covered by `days`, for the week band above the columns. */
export interface WeekBand {
  /** The Monday that opens the week — the label the band carries. */
  monday: string;
  /** Index into `days` of this week's first visible column. */
  startIdx: number;
  /** How many of `days` fall in this week. */
  span: number;
}

/**
 * Group a run of days into the weeks they belong to. The band shows each week's
 * Monday and holds it until the next week starts, so a phase crossing a week
 * boundary is obvious on a 2- or 6-week timeline.
 */
export function weekBands(days: string[]): WeekBand[] {
  const out: WeekBand[] = [];
  days.forEach((day, i) => {
    const monday = weekStart(day);
    const open = out[out.length - 1];
    if (open && open.monday === monday) open.span++;
    else out.push({ monday, startIdx: i, span: 1 });
  });
  return out;
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
