/*
 * ============================================================================
 *  TV STATUS BOARD — data shaping
 *
 *  Everything the office display reads, derived from the same rows and the same
 *  solver the Schedule itself uses. Pure functions, no database and no React,
 *  so the board can never drift from the timeline it is showing: if a phase
 *  moves on the Schedule, it moves here, because both ask schedule-math the
 *  same question.
 *
 *  Nothing here decides anything — the board is read-only by design. It exists
 *  to be looked at from across a room, so every function's job is to collapse
 *  the schedule down to what somebody standing ten feet away can actually take
 *  in: who is out today, who is where tomorrow, and how the weeks ahead look.
 * ============================================================================
 */

import {
  addDays,
  crewBudget,
  dayIsClashing,
  eachDay,
  findConflicts,
  isWeekend,
  isWorkingDay,
  mondayLabel,
  shiftLabel,
  shiftShort,
  weekAlignedRange,
  weekBands,
  weekStart,
  workedSegments,
  type AssigneeBooking,
  type ComputedWindow,
  type DayShift,
  type WeekBand,
  type WorkCalendar,
} from '@/lib/schedule-math';
import { shortDate } from '@/lib/format';
import type { ProjectStatus, ScheduleTaskRow, TaskStatus, WarehouseDay } from '@/lib/types';

/* ------------------------------------------------------------- A single day */

/** One person on a job for the day, as the board names them. */
export interface DayCrew {
  /** 'user:4' / 'sub:2' — stable across phases, so a head is counted once. */
  key: string;
  name: string;
  kind: 'user' | 'sub';
  /** Role for our own people, trade for a subcontractor. */
  detail: string | null;
  /** "All day" / "Starts 7:00 AM" / "8:00 AM – 12:00 PM · 4h". */
  shift: string;
  startTime: string | null;
  hours: number | null;
}

export interface DayPhase {
  taskId: number;
  name: string;
  status: TaskStatus;
  /** The shift everybody on the phase works, or null when they differ. */
  shift: string | null;
  crew: DayCrew[];
}

/** One job with somebody on it today — a card on the board. */
export interface DayJob {
  projectId: number;
  name: string;
  customer: string;
  siteAddress: string | null;
  location: string | null;
  phases: DayPhase[];
  /** Distinct heads on the job that day, ours and subs together. */
  headcount: number;
  /** The earliest start time anybody on the job has, for sorting the cards. */
  firstStart: string | null;
  /** The shift the whole job shares, or null when its phases differ. */
  shift: string | null;
}

export interface DayBoard {
  day: string;
  jobs: DayJob[];
  /** Our own people in the warehouse that day. */
  warehouse: { userId: number; name: string }[];
  /** 'user:4' / 'sub:2' for everybody booked on a job that day. */
  booked: Set<string>;
  /** Distinct heads out on jobs — the number the board leads with. */
  headcount: number;
}

/**
 * Everything happening on one day: the jobs with somebody on them, who that is
 * and when they start, plus the warehouse.
 *
 * Built from `assigneeBookings`, not from the crew-day rows directly, so it
 * inherits the rules those already settle — a subcontracted phase puts the sub
 * on every working day of its window, days left behind by a phase that has
 * since moved are dropped, and a day worked on a different shift carries its
 * own times.
 */
export function dayBoard(
  bookings: AssigneeBooking[],
  warehouse: WarehouseDay[],
  day: string
): DayBoard {
  const jobs = new Map<number, DayJob>();
  const booked = new Set<string>();

  for (const b of bookings) {
    if (b.start > day || b.end < day) continue;
    booked.add(b.key);

    let job = jobs.get(b.projectId);
    if (!job) {
      job = {
        projectId: b.projectId,
        name: b.projectName,
        customer: b.customer,
        siteAddress: b.siteAddress,
        location: b.location,
        phases: [],
        headcount: 0,
        firstStart: null,
        shift: null,
      };
      jobs.set(b.projectId, job);
    }

    let phase = job.phases.find((p) => p.taskId === b.taskId);
    if (!phase) {
      phase = { taskId: b.taskId, name: b.taskName, status: b.taskStatus, shift: null, crew: [] };
      job.phases.push(phase);
    }
    phase.crew.push({
      key: b.key,
      name: b.name,
      kind: b.kind,
      detail: b.detail,
      shift: shiftLabel(b),
      startTime: b.startTime,
      hours: b.hours,
    });
  }

  for (const job of jobs.values()) {
    const heads = new Set<string>();
    const shifts = new Set<string>();
    let earliest: string | null = null;

    for (const phase of job.phases) {
      // Our own people first, then the subs going with them — the card reads
      // as "the crew, plus who else is on site".
      phase.crew.sort(
        (a, b) => (a.kind === b.kind ? 0 : a.kind === 'user' ? -1 : 1) || a.name.localeCompare(b.name)
      );
      const phaseShifts = new Set(phase.crew.map((c) => c.shift));
      // A shift stated once on the phase beats the same shift repeated beside
      // every name; only a phase whose people genuinely differ says it per head.
      phase.shift = phaseShifts.size === 1 ? [...phaseShifts][0] : null;
      for (const c of phase.crew) {
        heads.add(c.key);
        shifts.add(c.shift);
        if (c.startTime && (earliest == null || c.startTime < earliest)) earliest = c.startTime;
      }
    }

    job.phases.sort(
      (a, b) => phaseStart(a).localeCompare(phaseStart(b)) || a.name.localeCompare(b.name)
    );
    job.headcount = heads.size;
    job.firstStart = earliest;
    job.shift = shifts.size === 1 ? [...shifts][0] : null;
  }

  const dayWarehouse = new Map<number, string>();
  for (const w of warehouse) {
    if (w.day === day) dayWarehouse.set(w.user_id, w.name);
  }

  return {
    day,
    // Early starts to the top: the board is read in the morning, and the 6 AM
    // job is the one somebody is trying to remember.
    jobs: [...jobs.values()].sort(
      (a, b) =>
        (a.firstStart ?? '99:99').localeCompare(b.firstStart ?? '99:99') ||
        a.name.localeCompare(b.name)
    ),
    warehouse: [...dayWarehouse]
      .map(([userId, name]) => ({ userId, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    booked,
    headcount: booked.size,
  };
}

/** The earliest start time on a phase, for ordering the day's phases. */
function phaseStart(phase: DayPhase): string {
  let earliest = '99:99';
  for (const c of phase.crew) if (c.startTime && c.startTime < earliest) earliest = c.startTime;
  return earliest;
}

/**
 * Our own people with nothing booked that day — no job, no warehouse.
 *
 * Only people who are in scheduling at all: an estimator who clocks in but is
 * never on the crew week isn't "available", they're simply not crew.
 */
export function availableCrew(
  workers: { id: number; name: string; schedulable: boolean }[],
  board: DayBoard
): string[] {
  const inWarehouse = new Set(board.warehouse.map((w) => w.userId));
  return workers
    .filter((w) => w.schedulable && !board.booked.has(`user:${w.id}`) && !inWarehouse.has(w.id))
    .map((w) => w.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * The next day with work on it, looking forward from `day`.
 *
 * Deliberately not "tomorrow": on a Friday afternoon the useful answer is
 * Monday, and on the week of a shutdown it's whichever day the crew is next
 * out. Falls back to the next working day so the rail always has something to
 * head itself with, even when nothing is booked yet.
 */
export function nextDayWithWork(
  bookings: AssigneeBooking[],
  warehouse: WarehouseDay[],
  day: string,
  cal: WorkCalendar,
  lookahead = 14
): string {
  let fallback: string | null = null;
  for (let i = 1; i <= lookahead; i++) {
    const d = addDays(day, i);
    if (fallback == null && isWorkingDay(d, cal)) fallback = d;
    const worked =
      bookings.some((b) => b.start <= d && b.end >= d) || warehouse.some((w) => w.day === d);
    if (worked) return d;
  }
  return fallback ?? addDays(day, 1);
}

/* ------------------------------------------------------------------ Alerts */

export type AlertKind = 'clash' | 'hard-finish' | 'staffing';

export interface BoardAlert {
  kind: AlertKind;
  text: string;
}

/**
 * The handful of things worth interrupting a status board for.
 *
 * Only ever what somebody in the office could act on today: a person booked in
 * two places, a job whose plan has run past a date it was promised for, and
 * work starting within the week that still has nobody on it. Everything else
 * the Schedule flags is a planning matter and stays on the Schedule.
 */
export function boardAlerts(
  tasks: ScheduleTaskRow[],
  windows: Map<number, ComputedWindow>,
  bookings: AssigneeBooking[],
  cal: WorkCalendar,
  from: string
): BoardAlert[] {
  const out: BoardAlert[] = [];

  // Double-bookings, but only ones still ahead of us — a clash on a day that
  // has already been worked is history nobody can fix from here.
  const clashes = findConflicts(bookings).filter((c) => c.end >= from);
  const clashed = new Map<string, string>();
  for (const c of clashes) if (!clashed.has(c.key)) clashed.set(c.key, `${c.name} (${shortDate(c.start)})`);
  if (clashed.size > 0) {
    const names = [...clashed.values()];
    out.push({
      kind: 'clash',
      text: `Double-booked: ${names.slice(0, 3).join(', ')}${
        names.length > 3 ? ` +${names.length - 3} more` : ''
      }`,
    });
  }

  // Jobs whose derived finish has run past the date they must be done by.
  const hardFinish = new Map<number, { name: string; hard: string; end: string }>();
  for (const t of tasks) {
    const hard = t.project_hard_finish_date;
    const w = windows.get(t.id);
    if (!hard || !w) continue;
    const seen = hardFinish.get(t.project_id);
    if (!seen) hardFinish.set(t.project_id, { name: t.project_name, hard, end: w.end });
    else if (w.end > seen.end) seen.end = w.end;
  }
  for (const job of hardFinish.values()) {
    if (job.end > job.hard) {
      out.push({
        kind: 'hard-finish',
        text: `${job.name} runs to ${shortDate(job.end)} — past its ${shortDate(job.hard)} hard finish`,
      });
    }
  }

  // Work starting inside the week that still has crew days nobody is on.
  const soon = addDays(from, 7);
  let phases = 0;
  let crewDays = 0;
  for (const t of tasks) {
    const w = windows.get(t.id);
    if (!w || w.start > soon || w.end < from) continue;
    const budget = crewBudget(t, w, cal);
    if (budget.remaining > 0) {
      phases++;
      crewDays += budget.remaining;
    }
  }
  if (phases > 0) {
    out.push({
      kind: 'staffing',
      text: `${crewDays} crew ${crewDays === 1 ? 'day' : 'days'} still to book on ${phases} ${
        phases === 1 ? 'phase' : 'phases'
      } starting within the week`,
    });
  }

  return out;
}

/* ---------------------------------------------------------------- Timeline */

/** One phase drawn on the timeline, clipped to the weeks on screen. */
export interface TimelineBar {
  key: string;
  taskId: number;
  label: string;
  status: TaskStatus;
  /** Column indexes into the day list, inclusive. */
  startIdx: number;
  endIdx: number;
  clippedLeft: boolean;
  clippedRight: boolean;
  /** Which stacked line inside the job's row this bar belongs on. */
  lane: number;
  /** Only the first stretch of a phase carries the label. */
  leading: boolean;
  /**
   * Empty columns to the right of this bar on its own lane. A bar too narrow
   * for its own name borrows them, so a one-day phase is still readable.
   */
  gapAfter: number;
}

/** One job's row on the timeline. */
export interface TimelineRow {
  projectId: number;
  name: string;
  customer: string;
  status: ProjectStatus;
  /** The whole job's derived span, however far outside the screen it runs. */
  start: string;
  end: string;
  /** How many stacked lines the row needs — phases that overlap each other. */
  lanes: number;
  bars: TimelineBar[];
  phases: number;
  /** Crew days still to book across the job's phases on screen. */
  toBook: number;
}

export interface TimelineModel {
  start: string;
  end: string;
  days: string[];
  bands: WeekBand[];
  rows: TimelineRow[];
  /** Live jobs with nothing on the board at all — named, not just counted. */
  unscheduled: { projectId: number; name: string; customer: string }[];
}

export interface TimelineProject {
  id: number;
  name: string;
  customer: string;
  status: ProjectStatus;
}

/**
 * The weeks ahead, one row per job.
 *
 * A row rather than a row per phase, because a board seen from across the room
 * answers "which jobs are running when" long before it answers "which phase" —
 * the phases are still there as separate bars, stacked into lanes where they
 * overlap, so a job running two phases at once reads as two lines rather than
 * one bar hiding the other.
 */
export function timelineModel(
  tasks: ScheduleTaskRow[],
  projects: TimelineProject[],
  windows: Map<number, ComputedWindow>,
  cal: WorkCalendar,
  anchor: string,
  weeks: number
): TimelineModel {
  const range = weekAlignedRange(anchor, weeks * 7);
  const days: string[] = [];
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) days.push(d);
  const index = new Map(days.map((d, i) => [d, i]));

  const byProject = new Map<number, ScheduleTaskRow[]>();
  for (const t of tasks) {
    const list = byProject.get(t.project_id);
    if (list) list.push(t);
    else byProject.set(t.project_id, [t]);
  }

  const rows: TimelineRow[] = [];
  const unscheduled: TimelineModel['unscheduled'] = [];

  for (const project of projects) {
    const phases = (byProject.get(project.id) ?? [])
      .map((t) => ({ task: t, window: windows.get(t.id) }))
      .filter((p): p is { task: ScheduleTaskRow; window: ComputedWindow } => p.window != null)
      .sort((a, b) => a.window.start.localeCompare(b.window.start));

    if (phases.length === 0) {
      unscheduled.push({ projectId: project.id, name: project.name, customer: project.customer });
      continue;
    }

    const jobStart = phases[0].window.start;
    const jobEnd = phases.reduce((latest, p) => (p.window.end > latest ? p.window.end : latest), phases[0].window.end);
    // A job whose work is all behind or all ahead of the weeks on screen isn't
    // a row — the board shows the window it is showing, not everything.
    if (jobStart > range.end || jobEnd < range.start) continue;

    // Lanes: a phase goes on the first line whose last bar has finished before
    // it starts, so overlapping phases stack instead of overwriting each other.
    const laneEnds: string[] = [];
    const bars: TimelineBar[] = [];
    let toBook = 0;

    for (const { task, window } of phases) {
      let lane = laneEnds.findIndex((end) => end < window.start);
      if (lane < 0) lane = laneEnds.push(window.end) - 1;
      else laneEnds[lane] = window.end;

      toBook += crewBudget(task, window, cal).remaining;

      // One bar per unbroken run of working days: the weekend gap is the point,
      // so a fortnight of work never reads as one continuous stretch.
      const segments = workedSegments(window.start, window.end, cal).filter(
        (s) => s.start <= range.end && s.end >= range.start
      );
      segments.forEach((s, i) => {
        const from = s.start < range.start ? range.start : s.start;
        const to = s.end > range.end ? range.end : s.end;
        const startIdx = index.get(from);
        const endIdx = index.get(to);
        if (startIdx == null || endIdx == null || endIdx < startIdx) return;
        bars.push({
          gapAfter: 0,
          key: `${task.id}-${s.start}`,
          taskId: task.id,
          label: task.subcontractor_name ? `${task.name} · ${task.subcontractor_name}` : task.name,
          status: task.status,
          startIdx,
          endIdx,
          clippedLeft: s.start < range.start,
          clippedRight: s.end > range.end,
          lane,
          leading: i === 0,
        });
      });
    }

    if (bars.length === 0) continue;
    labelRoom(bars, days.length);
    rows.push({
      projectId: project.id,
      name: project.name,
      customer: project.customer,
      status: project.status,
      start: jobStart,
      end: jobEnd,
      lanes: laneEnds.length,
      bars,
      phases: phases.length,
      toBook,
    });
  }

  rows.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  return { start: range.start, end: range.end, days, bands: weekBands(days), rows, unscheduled };
}

/**
 * How much clear space each bar has after it on its own lane.
 *
 * A one-day phase is two centimetres wide on a six-week board, which is not a
 * name — it's three letters and an ellipsis. Knowing the gap lets the label sit
 * in the empty columns beside the bar instead, and knowing it exactly is what
 * keeps that label from running over the phase that comes next.
 */
function labelRoom(bars: TimelineBar[], columns: number): void {
  const byLane = new Map<number, TimelineBar[]>();
  for (const bar of bars) {
    const lane = byLane.get(bar.lane);
    if (lane) lane.push(bar);
    else byLane.set(bar.lane, [bar]);
  }
  for (const lane of byLane.values()) {
    lane.sort((a, b) => a.startIdx - b.startIdx);
    lane.forEach((bar, i) => {
      const next = lane[i + 1];
      bar.gapAfter = (next ? next.startIdx : columns) - bar.endIdx - 1;
    });
  }
}

/** "Aug 24 – Sep 13" — the span a timeline page is headed with. */
export function spanLabel(start: string, end: string): string {
  return `${mondayLabel(start)} – ${mondayLabel(end)}`;
}

/** Split rows into screens of `size`, so a long board pages instead of shrinking. */
export function paginate<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

/* -------------------------------------------------------------- Crew week */

/** What somebody is on, on one day — a phase of a job, or the warehouse. */
interface CrewEntry {
  /** 'task:12' / 'warehouse' — what a run of days is joined by. */
  key: string;
  projectId: number | null;
  /** The job, or "Warehouse". */
  label: string;
  phase: string | null;
  status: TaskStatus | null;
  shift: DayShift;
}

/** A run of days one person works the same thing, on the same shift. */
export interface CrewSpan {
  key: string;
  label: string;
  phase: string | null;
  /** "8a", "8–12" — the shift at chip width, empty when it's all day. */
  shift: string;
  status: TaskStatus | null;
  /** First and last visible column, inclusive. */
  startIdx: number;
  endIdx: number;
  lane: number;
  /** This card shares a day with another job whose hours collide. */
  clash: boolean;
}

/** One person's line across the weeks. */
export interface CrewRow {
  key: string;
  kind: 'user' | 'sub';
  name: string;
  detail: string | null;
  spans: CrewSpan[];
  lanes: number;
  /** Visible columns they're booked on — 0 is somebody with a free fortnight. */
  bookedDays: number;
}

export interface CrewWeekModel {
  start: string;
  end: string;
  /** The days actually drawn: weekends only when somebody is on them. */
  columns: string[];
  bands: WeekBand[];
  rows: CrewRow[];
}

/**
 * Where everybody is, a fortnight at a time — one row per person, one column
 * per day.
 *
 * The Schedule's Crew Week is where this is *staffed*; this is the same picture
 * with nothing to click, for a room to read. It follows the same two rules that
 * make that grid legible: a run of days on one job at one shift is a single
 * card rather than one chip per day, and a weekend stays off the grid unless
 * somebody is actually booked on it.
 *
 * People with nothing booked keep their row. On a wall board "who is free this
 * week" is half the question being asked, and an empty line answers it.
 */
export function crewWeekModel(
  bookings: AssigneeBooking[],
  warehouse: WarehouseDay[],
  workers: { id: number; name: string; schedulable: boolean }[],
  anchor: string,
  weeks: number
): CrewWeekModel {
  const range = weekAlignedRange(anchor, weeks * 7);
  const allDays: string[] = [];
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) allDays.push(d);

  const byPerson = new Map<
    string,
    { kind: 'user' | 'sub'; name: string; detail: string | null; days: Map<string, CrewEntry[]> }
  >();
  const put = (
    key: string,
    kind: 'user' | 'sub',
    name: string,
    detail: string | null,
    day: string,
    entry: CrewEntry
  ) => {
    let person = byPerson.get(key);
    if (!person) {
      person = { kind, name, detail, days: new Map() };
      byPerson.set(key, person);
    }
    const list = person.days.get(day);
    if (list) list.push(entry);
    else person.days.set(day, [entry]);
  };

  for (const b of bookings) {
    if (b.start > range.end || b.end < range.start) continue;
    for (const day of eachDay(b.start, b.end)) {
      if (day < range.start || day > range.end) continue;
      put(b.key, b.kind, b.name, b.detail, day, {
        key: `task:${b.taskId}`,
        projectId: b.projectId,
        label: b.projectName,
        phase: b.taskName,
        status: b.taskStatus,
        shift: { startTime: b.startTime, hours: b.hours },
      });
    }
  }
  for (const w of warehouse) {
    if (w.day < range.start || w.day > range.end) continue;
    put(`user:${w.user_id}`, 'user', w.name, w.detail, w.day, {
      key: 'warehouse',
      projectId: null,
      label: 'Warehouse',
      phase: null,
      status: null,
      shift: { startTime: null, hours: null },
    });
  }

  // A Saturday nobody is on is not a column: a normal fortnight stays ten wide,
  // and a weekend that IS worked is exactly the thing to show.
  const columns = allDays.filter((d) => {
    if (!isWeekend(d)) return true;
    return [...byPerson.values()].some((p) => (p.days.get(d)?.length ?? 0) > 0);
  });

  const rows: CrewRow[] = [];
  const rowFor = (key: string, kind: 'user' | 'sub', name: string, detail: string | null) => {
    const days = byPerson.get(key)?.days ?? new Map<string, CrewEntry[]>();
    const { spans, lanes } = crewSpans(days, columns);
    return {
      key,
      kind,
      name,
      detail,
      spans,
      lanes,
      bookedDays: columns.filter((d) => (days.get(d)?.length ?? 0) > 0).length,
    };
  };

  for (const w of workers) {
    const key = `user:${w.id}`;
    // Somebody out of scheduling only appears while they still have days on the
    // board — the same forgiveness the Crew Week gives them.
    if (!w.schedulable && !byPerson.has(key)) continue;
    rows.push(rowFor(key, 'user', w.name, null));
  }
  for (const [key, person] of byPerson) {
    if (person.kind === 'sub') rows.push(rowFor(key, 'sub', person.name, person.detail));
  }

  rows.sort(
    (a, b) => (a.kind === b.kind ? 0 : a.kind === 'user' ? -1 : 1) || a.name.localeCompare(b.name)
  );
  return { start: range.start, end: range.end, columns, bands: weekBands(columns), rows };
}

/**
 * One person's days, gathered into the cards their row draws.
 *
 * Days join up when they're the same booking on the same shift in adjacent
 * columns of the same week: a card spanning days is stating one shift for all
 * of them, and the grid bands the weeks apart anyway. Cards that overlap stack
 * into lanes, so a two-day job and the half day beside it each keep a line.
 */
function crewSpans(
  days: Map<string, CrewEntry[]>,
  columns: string[]
): { spans: CrewSpan[]; lanes: number } {
  const spans: CrewSpan[] = [];
  const open = new Map<string, CrewSpan>();

  columns.forEach((day, i) => {
    const entries = days.get(day) ?? [];
    // Only a real double-booking rings a card: two phases of one job, or two
    // bounded shifts that clear each other, are somebody's ordinary day.
    const clashing = dayIsClashing(
      entries
        .filter((e) => e.projectId != null)
        .map((e) => ({ projectId: e.projectId as number, shift: e.shift }))
    );
    for (const entry of entries) {
      const run = open.get(entry.key);
      const joins =
        run != null &&
        run.endIdx === i - 1 &&
        weekStart(columns[run.endIdx]) === weekStart(day) &&
        run.shift === shiftShort(entry.shift);
      if (joins && run) {
        run.endIdx = i;
        run.clash = run.clash || clashing;
      } else {
        const started: CrewSpan = {
          key: entry.key,
          label: entry.label,
          phase: entry.phase,
          shift: shiftShort(entry.shift),
          status: entry.status,
          startIdx: i,
          endIdx: i,
          lane: 0,
          clash: clashing,
        };
        spans.push(started);
        open.set(entry.key, started);
      }
    }
  });

  const laneEnds: number[] = [];
  for (const span of spans) {
    let lane = laneEnds.findIndex((end) => end < span.startIdx);
    if (lane === -1) lane = laneEnds.push(span.endIdx) - 1;
    else laneEnds[lane] = span.endIdx;
    span.lane = lane;
  }
  return { spans, lanes: Math.max(1, laneEnds.length) };
}
