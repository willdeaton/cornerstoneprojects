'use client';

import { Fragment, useEffect, useMemo, useState, type DragEvent } from 'react';
import { shortDate } from '@/lib/format';
import {
  DAY_LABELS,
  addDays,
  computeSchedule,
  crewBudget,
  crewByDay,
  eachDay,
  fromDay,
  isWeekend,
  isWorkingDay,
  mondayLabel,
  rangeLabel,
  dayIsClashing,
  dayIsSplit,
  shiftLabel,
  shiftOn,
  shiftShort,
  today,
  weekAlignedRange,
  weekBands,
  weekLabel,
  weekStart,
  dayTimeMap,
  type ComputedWindow,
  type DayShift,
} from '@/lib/schedule-math';
import type { CrewNote, ScheduleTaskRow, WarehouseDay } from '@/lib/types';
import type { DraftPerson } from '@/lib/schedule-draft';
import type { ScheduleDraft } from './useScheduleDraft';
import { CrewJobCard, type CardFocus } from './CrewJobCard';
import type { SubOption, WorkerOption } from './TaskModal';
import type { PublishedInfo } from './PublishBar';

/**
 * One thing a person is on for one day: a phase of a job, or a day in the
 * warehouse.
 *
 * On a phase, `shift` is when they're there and for how long — all day unless
 * the job card put hours on it, which is what lets two of these share a day —
 * and `contracted` days come from the phase being subcontracted rather than
 * from a crew-day booking, so they're read-only. A `finished` day is a record
 * of work already done: still editable, but only behind a confirmation. A
 * warehouse day carries none of that: it is standing work, all day, never
 * contracted and never history.
 */
type DayEntry =
  | {
      kind: 'phase';
      task: ScheduleTaskRow;
      shift: DayShift;
      contracted: boolean;
      /** The job is finished: the day is a record of what was worked, not a booking. */
      finished: boolean;
    }
  | { kind: 'warehouse' };

/** Which of the two a day entry is, for de-duplicating a cell's contents. */
function entryKey(e: DayEntry): string {
  return e.kind === 'warehouse' ? 'warehouse' : `task:${e.task.id}`;
}

/**
 * One booking drawn as a single card across the days it covers.
 *
 * Two days of the same job at the same time is one visit, not two, so it is one
 * card stretched over both columns — which is how somebody reading the grid
 * actually thinks about it. `lane` stacks the cards a person has on overlapping
 * days, so a two-day job and the half day beside it each keep a row of their
 * own.
 */
interface DaySpan {
  /** The task or the warehouse — what the card is. */
  key: string;
  entry: DayEntry;
  /** First and last visible column the card covers, inclusive. */
  startIdx: number;
  endIdx: number;
  lane: number;
}

/** Two shifts a card can be drawn as one across — same start, same length. */
function sameShift(a: DayShift, b: DayShift): boolean {
  return a.startTime === b.startTime && a.hours === b.hours;
}

/**
 * A person's day entries, gathered into the cards the row draws.
 *
 * Days join up when they are the same booking, on the same shift, in adjacent
 * columns of the same week. A different start time breaks the run — a card says
 * what time the crew is there, and a card covering two days with two different
 * times would be saying something untrue — and so does a week boundary, because
 * the grid bands the weeks apart and a card straddling that gap reads as one
 * continuous stretch when it isn't.
 */
function buildSpans(
  days: Map<string, DayEntry[]>,
  columns: string[]
): { spans: DaySpan[]; lanes: number } {
  const runs: DaySpan[] = [];
  const open = new Map<string, DaySpan>();
  columns.forEach((day, i) => {
    for (const entry of days.get(day) ?? []) {
      const key = entryKey(entry);
      const run = open.get(key);
      const joins =
        run != null &&
        run.endIdx === i - 1 &&
        weekStart(columns[run.endIdx]) === weekStart(day) &&
        (entry.kind === 'warehouse' ||
          (run.entry.kind === 'phase' && sameShift(run.entry.shift, entry.shift)));
      if (joins) run!.endIdx = i;
      else {
        const started: DaySpan = { key, entry, startIdx: i, endIdx: i, lane: 0 };
        runs.push(started);
        open.set(key, started);
      }
    }
  });
  // Cards are laid into the first lane that is clear by the day they start, so
  // a row is only ever as tall as the days it has to stack.
  const laneEnds: number[] = [];
  for (const run of runs) {
    let lane = laneEnds.findIndex((end) => end < run.startIdx);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(run.endIdx);
    } else laneEnds[lane] = run.endIdx;
    run.lane = lane;
  }
  return { spans: runs, lanes: Math.max(1, laneEnds.length) };
}

/** Widths the crew grid opens at, in whole weeks — two by default. */
const SPANS = [
  { weeks: 1, label: 'Week' },
  { weeks: 2, label: '2 Weeks' },
] as const;

const DEFAULT_WEEKS = 2;

/** What a card being dragged carries. Read on drop; the state drives the hover. */
const DRAG_TYPE = 'application/x-cornerstone-phase';

/**
 * The standing warehouse card.
 *
 * Every other card on the board is a phase of a job, and comes and goes with
 * the weeks that job runs in. The warehouse is always there — somebody has to
 * load out, take the delivery and put the stock away, whatever is on site — so
 * it is not filed under a week and it never fills up: there is no customer, no
 * phase and no crew budget behind it, only a day and a person.
 */
const WAREHOUSE = 'warehouse' as const;

/** What the grid is booking right now: one job phase, or the warehouse. */
type Target = number | typeof WAREHOUSE;

/** A phase card, as both the work band and the grid need it. */
interface PhaseCard {
  task: ScheduleTaskRow;
  window: ComputedWindow;
  budget: ReturnType<typeof crewBudget>;
  byDay: Map<string, { kind: 'user' | 'sub'; ref_id: number }[]>;
  /** The phase's working days that are on screen — the default days to book. */
  days: string[];
  /** Its job is finished: on screen as history, with nothing left to staff. */
  finished: boolean;
}

interface Person {
  key: string;
  kind: 'user' | 'sub';
  refId: number;
  name: string;
  detail: string;
  /** False for somebody taken out of scheduling who is still booked in view. */
  schedulable: boolean;
}

/**
 * One stretch of days being dragged out along a person's row: press a day (or a
 * booking already on one), drag sideways, let go, and the phase is booked
 * across every day the drag covered.
 */
interface RangeDrag {
  personKey: string;
  target: Target;
  from: string;
  to: string;
}

/**
 * The weeks the crew is actually staffed in — a fortnight at a time, with the
 * work to be staffed sitting above it, each phase filed under the week it
 * starts in.
 *
 * Every phase of every job with work on screen gets its own small card in that
 * band: two phases of the same job are two cards, because they're two different
 * asks with two different budgets. Drag a card onto somebody's day to book them
 * for that day, or onto their name to put them on every weekday of it that's on
 * screen. Clicking a card still picks it for click-to-book, which is what
 * touchscreens and keyboards get — and with one picked, dragging across a row
 * stretches the phase over that whole run of days at once.
 *
 * On the grid itself, a booking is drawn as ONE card across the days it covers:
 * two days of the same job at the same time is one visit, so it is one card over
 * both columns rather than a chip repeated per day. Clicking it opens the job —
 * the details, the shift, the days, the crew notes — because that is what
 * somebody looking at a day on a schedule is asking. Taking a person off is the
 * × in the card's corner, so the destructive thing is the deliberate thing.
 *
 * Weekends are hidden until they matter: tick Weekends (or have somebody booked
 * on one already) and Saturday and Sunday join the grid, bookable like any other
 * day. A weekend worked doesn't spend the weekdays' budget — it brings a day of
 * its own, because it IS an extra day of work.
 *
 * A subcontracted phase is read-only here. The sub was engaged on the timeline,
 * so they're on site every working day of it and their days follow its dates —
 * there's no budget to spend, so its card can't be dragged or picked. Only the
 * crew we send alongside them, if any, is booked here.
 *
 * A finished job's phases show on the weeks they ran, dimmed but editable, so
 * paging back to a previous week shows who actually worked it rather than a gap
 * where the job used to be. The days on them are a record rather than a plan —
 * and a record that turns out to be wrong has to be correctable — so they can
 * still be booked and cleared, and every change to one is confirmed first.
 *
 * The timeline says a phase needs three people for four days; this is where
 * those twelve crew-days get spent. The budget is a total rather than a per-day
 * quota, so four people Monday and one Friday is a legitimate way to cover a
 * 2-crew, 5-day phase — which is how a week usually falls. A day carrying more
 * than the phase asked for is flagged, never blocked.
 */
export function CrewWeek({
  tasks,
  warehouse,
  workers,
  subs,
  holidays,
  published = {},
  crewNotes = [],
  draft,
  finishedProjects = [],
}: {
  tasks: ScheduleTaskRow[];
  /** Who is in the warehouse on which day — the standing card's bookings. */
  warehouse: WarehouseDay[];
  workers: WorkerOption[];
  subs: SubOption[];
  holidays: string[];
  /** Publish state per job id, so a card can say a change needs a reason. */
  published?: Record<number, PublishedInfo>;
  /**
   * The job notes written for whoever works each job, so a card opened off the
   * grid carries them without a second trip to the job.
   */
  crewNotes?: CrewNote[];
  /**
   * The draft every booking goes into. Bookings are queued rather than written,
   * so the grid answers instantly and the save happens on its own ten seconds
   * later — and nobody is emailed until the schedule is published.
   */
  draft: ScheduleDraft;
  /**
   * Jobs that are finished. Their days show on the weeks they were worked —
   * that's what a previous week is for — and can still be corrected, with every
   * change confirmed first. They count towards no shortfall: a job that is over
   * is not work still to staff.
   */
  finishedProjects?: number[];
}) {
  /** How many weeks are on screen. The nav steps one week at a time regardless. */
  const [weeks, setWeeks] = useState<number>(DEFAULT_WEEKS);
  const [anchor, setAnchor] = useState<string>(() => weekStart(today()));
  const [showIdle, setShowIdle] = useState(true);
  /** Opens Saturday and Sunday up, for the weeks the crew has to work one. */
  const [showWeekends, setShowWeekends] = useState(false);
  /** Narrows the work band to phases still missing crew. */
  const [onlyShort, setOnlyShort] = useState(false);
  /** Free-text filter over the work band — job, phase or customer. */
  const [search, setSearch] = useState('');
  /** The card picked by click, for booking without a mouse drag. */
  const [picked, setPicked] = useState<Target | null>(null);
  /** The card currently being dragged. */
  const [dragging, setDragging] = useState<Target | null>(null);
  /** The cell or name the drag is over: `person|day`, or `person|row`. */
  const [over, setOver] = useState<string | null>(null);
  /** The stretch of days currently being dragged out along one person's row. */
  const [range, setRange] = useState<RangeDrag | null>(null);
  /**
   * The phase whose card is open, and — when it was opened by clicking somebody's
   * booking rather than the card's ⋯ — whose day it was.
   */
  const [opened, setOpened] = useState<{ taskId: number; focus: CardFocus | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const calendar = useMemo(() => ({ holidays: new Set(holidays) }), [holidays]);
  const finished = useMemo(() => new Set(finishedProjects), [finishedProjects]);
  const now = today();

  const { windows } = useMemo(() => computeSchedule(tasks, calendar), [tasks, calendar]);

  // Always a whole number of weeks starting on a Monday: the crew reads the
  // schedule a week at a time, and a fortnight that opened mid-week would put
  // the same weekday in a different column every time it was paged.
  const range7 = useMemo(() => weekAlignedRange(anchor, weeks * 7), [anchor, weeks]);
  const rangeDays = useMemo(() => eachDay(range7.start, range7.end), [range7]);
  const rangeFrom = range7.start;
  const rangeTo = range7.end;

  /** The phases with work in view — one card per job and phase, in date order. */
  const cards = useMemo<PhaseCard[]>(() => {
    return tasks
      .map((task) => ({ task, window: windows.get(task.id) }))
      .filter(
        (c): c is { task: ScheduleTaskRow; window: ComputedWindow } =>
          !!c.window && c.window.start <= rangeTo && c.window.end >= rangeFrom
      )
      .map(({ task, window }) => ({
        task,
        window,
        budget: crewBudget(task, window, calendar),
        byDay: crewByDay(task),
        days: rangeDays.filter(
          (d) => d >= window.start && d <= window.end && isWorkingDay(d, calendar)
        ),
        finished: finished.has(task.project_id),
      }))
      .sort((a, b) =>
        a.window.start === b.window.start
          ? a.task.project_name.localeCompare(b.task.project_name) ||
            a.task.name.localeCompare(b.task.name)
          : a.window.start < b.window.start
            ? -1
            : 1
      );
  }, [tasks, windows, calendar, rangeDays, rangeFrom, rangeTo, finished]);

  const cardByTask = useMemo(() => new Map(cards.map((c) => [c.task.id, c])), [cards]);
  // Dragging takes over from clicking, so the grid highlights whichever phase
  // the manager is actually working with.
  const active: Target | null = dragging ?? picked;
  const activeCard = typeof active === 'number' ? cardByTask.get(active) : undefined;
  /** True while the standing warehouse card is the one being booked. */
  const activeWarehouse = active === WAREHOUSE;
  const openedCard = opened != null ? cardByTask.get(opened.taskId) : undefined;

  /** The job notes to hand a card, indexed by job. */
  const notesByJob = useMemo(() => {
    const out = new Map<number, CrewNote[]>();
    for (const n of crewNotes) {
      const list = out.get(n.project_id);
      if (list) list.push(n);
      else out.set(n.project_id, [n]);
    }
    return out;
  }, [crewNotes]);

  /**
   * Person -> day -> the phases they're on that day, in view.
   *
   * `contracted` marks a day that comes from the phase being subcontracted
   * rather than from a booking: the sub is on site because they hold the work,
   * so that day can't be dropped on or clicked away here — it follows the
   * phase's dates and changes on the timeline.
   */
  const byPerson = useMemo(() => {
    const out = new Map<string, Map<string, DayEntry[]>>();
    const add = (key: string, day: string, entry: DayEntry) => {
      let days = out.get(key);
      if (!days) {
        days = new Map();
        out.set(key, days);
      }
      const list = days.get(day);
      if (list) {
        // The sub who holds the phase is already on every day of it.
        if (!list.some((e) => entryKey(e) === entryKey(entry))) list.push(entry);
      } else days.set(day, [entry]);
    };

    for (const card of cards) {
      const { task } = card;
      const times = dayTimeMap(task.day_times ?? []);
      if (task.subcontractor_id != null) {
        for (const day of card.days) {
          add(`sub:${task.subcontractor_id}`, day, {
            kind: 'phase',
            task,
            shift: shiftOn(day, task, times),
            contracted: true,
            finished: card.finished,
          });
        }
      }
      for (const c of task.crew_days ?? []) {
        if (c.day < rangeFrom || c.day > rangeTo) continue;
        add(`${c.kind}:${c.ref_id}`, c.day, {
          kind: 'phase',
          task,
          shift: shiftOn(c.day, task, times),
          contracted: false,
          finished: card.finished,
        });
      }
    }
    // Warehouse days sit in the same map as the job bookings, so a day in the
    // warehouse counts as a day booked and the grid draws it in the same cell.
    for (const w of warehouse) {
      if (w.day < rangeFrom || w.day > rangeTo) continue;
      add(`user:${w.user_id}`, w.day, { kind: 'warehouse' });
    }
    return out;
  }, [cards, warehouse, rangeFrom, rangeTo]);

  // A weekend column shows when the weekends have been opened up, or when that
  // particular Saturday or Sunday already has somebody on it. Otherwise a normal
  // fortnight stays ten columns wide and nobody reads a weekend into the plan.
  const columns = useMemo(
    () =>
      rangeDays.filter((d) => {
        if (!isWeekend(d)) return true;
        if (showWeekends) return true;
        return [...byPerson.values()].some((days) => (days.get(d)?.length ?? 0) > 0);
      }),
    [rangeDays, byPerson, showWeekends]
  );

  /** One band per week over the columns, so each week is labelled above its days. */
  const bands = useMemo(() => weekBands(columns), [columns]);

  const people = useMemo(() => {
    const rows: Person[] = [
      ...workers.map((w) => ({
        key: `user:${w.id}`,
        kind: 'user' as const,
        refId: w.id,
        name: w.name,
        detail: w.role,
        schedulable: w.schedulable !== false,
      })),
      ...subs.map((s) => ({
        key: `sub:${s.id}`,
        kind: 'sub' as const,
        refId: s.id,
        name: s.name,
        detail: s.trade ?? 'Subcontractor',
        schedulable: true,
      })),
    ];
    return rows
      .map((p) => {
        const days = byPerson.get(p.key) ?? new Map<string, DayEntry[]>();
        const booked = columns.filter((d) => (days.get(d)?.length ?? 0) > 0);
        // Two different jobs on one day is only a double-booking if the hours
        // actually collide: all day here and all day there does, but 8-till-noon
        // and noon-till-four is one person covering two sites. Two phases of the
        // same job never clash — that's one crew doing two things in one place —
        // and a finished job never counts either: the day has been worked, so
        // there's nothing left to resolve.
        const clashes = columns.filter((d) => clashing(days.get(d) ?? []));
        // A day deliberately shared between jobs, hours and all — worth showing,
        // but as a plan rather than a warning.
        const splits = columns.filter((d) => splitting(days.get(d) ?? []));
        // The cards the row actually draws: a run of days on one job at one
        // time is one card, and cards on overlapping days stack in lanes.
        const { spans, lanes } = buildSpans(days, columns);
        return { ...p, days, bookedCount: booked.length, clashes, splits, spans, lanes };
      })
      // Somebody taken out of scheduling under Settings -> Users isn't offered
      // here at all — unless they're already booked in view, in which case
      // hiding them would quietly drop a name off a schedule the crew has.
      .filter((p) => p.schedulable || p.bookedCount > 0)
      .filter((p) => showIdle || p.bookedCount > 0)
      // Our people and the subs are drawn as two sections, so the ordering that
      // matters is by name inside each one.
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [workers, subs, byPerson, columns, showIdle]);

  /**
   * The rows, in the two sections the grid draws them as: our own people, then
   * the subcontractors under them.
   *
   * They book the same way and share every rule, but they answer two different
   * questions — "who of ours is where this week" and "which subs are on site" —
   * and a sub sorted into the middle of a crew list answers neither cleanly.
   */
  const sections = useMemo(
    () => [
      { id: 'crew' as const, rows: people.filter((p) => p.kind === 'user') },
      { id: 'subs' as const, rows: people.filter((p) => p.kind === 'sub') },
    ],
    [people]
  );

  // Day columns share whatever width is left rather than claiming a fixed one,
  // so a whole fortnight fits beside the names instead of scrolling out of
  // sight. Chips truncate and carry the full job on hover; the Week view is
  // where a narrow screen goes for detail.
  const gridTemplate = `minmax(112px, 150px) repeat(${columns.length}, minmax(0, 1fr))`;
  const gridMinWidth = columns.length > 7 ? 880 : 660;
  const bookedPeople = people.filter((p) => p.bookedCount > 0).length;
  const understaffed = cards.filter((c) => !c.finished && c.budget.remaining > 0).length;
  /** Warehouse days booked inside the weeks on screen, for the standing card. */
  const warehouseInView = warehouse.filter((w) => w.day >= rangeFrom && w.day <= rangeTo).length;
  const needle = search.trim().toLowerCase();
  const bandCards = cards
    // "Still needing crew" is a list of work to do, so a job that is over is
    // never on it — its card is only ever there to say what ran that week.
    .filter((c) => !onlyShort || (!c.finished && c.budget.remaining > 0))
    .filter(
      (c) =>
        needle === '' ||
        `${c.task.project_name} ${c.task.name} ${c.task.customer}`.toLowerCase().includes(needle)
    );
  // Which week's column a card belongs above: the week it starts in, or the
  // first week on screen when it started before this view opened.
  const cardsByWeek = useMemo(() => {
    const out = new Map<string, PhaseCard[]>();
    for (const b of bands) out.set(b.monday, []);
    const first = bands[0]?.monday;
    for (const c of bandCards) {
      const monday = weekStart(c.window.start);
      const bucket = out.get(monday) ?? (first ? out.get(first) : undefined);
      bucket?.push(c);
    }
    return out;
  }, [bandCards, bands]);
  const bandFinished = bandCards.filter((c) => c.finished).length;
  const bandLive = bandCards.length - bandFinished;
  const heading = weeks === 1 ? weekLabel(rangeFrom) : rangeLabel(rangeFrom, rangeTo);
  /** Weekend and holiday days somebody is actually booked on, in view. */
  const workedOffDays = columns.filter(
    (d) =>
      !isWorkingDay(d, calendar) &&
      [...byPerson.values()].some((days) => (days.get(d)?.length ?? 0) > 0)
  );

  /** Is this person already on this phase that day? */
  function isBooked(card: PhaseCard, day: string, person: Person): boolean {
    return (card.byDay.get(day) ?? []).some(
      (c) => c.kind === person.kind && c.ref_id === person.refId
    );
  }

  /**
   * A phase with crew of ours to book — a subcontracted one may have none.
   *
   * A finished job's phases count: the days on them are the record of a week
   * that was worked, and a record that turns out to be wrong has to be
   * correctable. Every change to one is confirmed first — see
   * `agreedToChangeFinished`.
   */
  function isStaffable(card: PhaseCard): boolean {
    return card.budget.capacity > 0;
  }

  /**
   * Room left on a phase for one more day of somebody.
   *
   * A weekend or holiday nobody is on yet is an extra day of work rather than a
   * slice of the planned ones, so it brings its own crew_size of budget with it
   * — the same rule the server applies when the booking lands.
   */
  function hasRoom(card: PhaseCard, day: string): boolean {
    if (!card.budget.full) return true;
    return !isWorkingDay(day, calendar) && !card.byDay.has(day);
  }

  /**
   * A day this phase can take crew on: inside the phase's window, not already
   * full, and not the sub who holds the phase — their days come with the
   * contract, so there's nothing here to give or take. Weekends count, which is
   * how a weekend gets worked; they're only ever offered on a column the
   * manager has opened up.
   */
  function canTake(card: PhaseCard, day: string, person: Person): boolean {
    if (!isStaffable(card)) return false;
    if (person.kind === 'sub' && card.task.subcontractor_id === person.refId) return false;
    if (day < card.window.start || day > card.window.end) return false;
    return isBooked(card, day, person) || hasRoom(card, day);
  }

  /** Is this person in the warehouse that day? */
  function inWarehouse(day: string, person: Person): boolean {
    return (
      person.kind === 'user' && warehouse.some((w) => w.day === day && w.user_id === person.refId)
    );
  }

  /**
   * Is this person already on whatever is being booked, that day? The warehouse
   * and a phase answer it from different rows, so every caller asks here.
   */
  function isOn(target: Target, day: string, person: Person): boolean {
    if (target === WAREHOUSE) return inWarehouse(day, person);
    const card = cardByTask.get(target);
    return !!card && isBooked(card, day, person);
  }

  /**
   * Can this be booked on that person's day at all?
   *
   * A phase answers with its window and its budget. The warehouse answers with
   * one rule: our own people only. Subs are contracted to a job's phase on the
   * timeline, and the warehouse is not a job — there is nothing to contract.
   */
  function takesDay(target: Target, day: string, person: Person): boolean {
    if (target === WAREHOUSE) return person.kind === 'user';
    const card = cardByTask.get(target);
    return !!card && canTake(card, day, person);
  }

  /**
   * A change to a job that is over gets said out loud first.
   *
   * Finished jobs are editable here — a day that was worked and never booked, or
   * booked against the wrong person, has to be fixable without reopening the
   * whole job — but their days are the record of work already done and probably
   * already paid. So every edit to one is confirmed, and there is no unlocked
   * mode to forget you left on. The warehouse is not a job: nothing to confirm.
   */
  function agreedToChangeFinished(target: Target): boolean {
    if (target === WAREHOUSE) return true;
    const card = cardByTask.get(target);
    if (!card?.finished) return true;
    return confirm(
      `${card.task.project_name} is finished. Changing the crew days on "${card.task.name}" ` +
        `changes the record of work that has already been done.\n\nGo ahead with the change?`
    );
  }

  /** Book whatever is picked onto a run of that person's days. */
  function bookDays(target: Target, person: Person, days: string[]) {
    if (!agreedToChangeFinished(target)) return;
    if (target === WAREHOUSE) return bookWarehouse(person, days);
    const card = cardByTask.get(target);
    if (card) bookSpan(card, person, days);
  }

  /** Take that person back off those days of whatever is picked. */
  function unbookDays(target: Target, person: Person, days: string[]) {
    if (!agreedToChangeFinished(target)) return;
    if (target === WAREHOUSE) return unbookWarehouse(person, days);
    const task = tasks.find((t) => t.id === target);
    if (task) unbook(task, person, days);
  }

  /**
   * Put one person in the warehouse for a run of days. Nothing to check but
   * whose days they are: the card never fills up, and any day — weekend
   * included, once its column is open — is a day somebody can be in there.
   */
  function bookWarehouse(person: Person, days: string[]) {
    setError(null);
    const bookable = days.filter((d) => !inWarehouse(d, person));
    if (bookable.length === 0) {
      setError(`${person.name} is already in the warehouse on those days.`);
      return;
    }
    draft.queue({
      kind: 'warehouse-book',
      userId: person.refId,
      label: `${person.name} in the warehouse`,
      person: draftPerson(person),
      days: bookable,
    });
  }

  /** Take one person out of the warehouse for the given days. */
  function unbookWarehouse(person: Person, days: string[]) {
    draft.queue({
      kind: 'warehouse-unbook',
      userId: person.refId,
      label: `${person.name} out of the warehouse`,
      person: draftPerson(person),
      days,
    });
  }

  /** The person, as the draft records a booking against them. */
  function draftPerson(person: Person): DraftPerson {
    return {
      kind: person.kind,
      ref_id: person.refId,
      name: person.name,
      detail: person.detail || null,
    };
  }

  /** Book the picked card onto one person's day, or take them back off it. */
  function toggleCell(person: Person, day: string) {
    if (active == null) return;
    setError(null);
    if (isOn(active, day, person)) unbookDays(active, person, [day]);
    else bookDays(active, person, [day]);
  }

  /** A card dropped on one day cell books that one day. */
  function dropOnDay(target: Target, person: Person, day: string) {
    setError(null);
    if (isOn(target, day, person)) return; // Dropping where they already are is a no-op.
    bookDays(target, person, [day]);
  }

  /**
   * Book one person across a run of days of one phase. The phase's own rules are
   * checked here, against the draft, before the booking joins it — the same
   * checks the server runs again when the draft is saved.
   */
  function bookSpan(card: PhaseCard, person: Person, days: string[]) {
    setError(null);
    const bookable = days.filter((d) => canTake(card, d, person) && !isBooked(card, d, person));
    if (bookable.length === 0) {
      setError(
        card.budget.full
          ? `${card.task.name} is fully staffed — ${card.budget.capacity} crew ${
              card.budget.capacity === 1 ? 'day' : 'days'
            } planned. Take somebody off a day, or raise the crew it needs on the timeline.`
          : `Nothing to book there — ${person.name} is already on those days of ${card.task.name}, or the phase doesn't run then.`
      );
      return;
    }
    draft.queue({
      kind: 'crew-book',
      projectId: card.task.project_id,
      taskId: card.task.id,
      label: `${person.name} on ${card.task.name} (${card.task.project_name})`,
      person: draftPerson(person),
      days: bookable,
    });
  }

  /** Take one person off given days of a phase. */
  function unbook(task: ScheduleTaskRow, person: Person, days: string[]) {
    draft.queue({
      kind: 'crew-unbook',
      projectId: task.project_id,
      taskId: task.id,
      label: `${person.name} off ${task.name} (${task.project_name})`,
      person: draftPerson(person),
      days,
    });
  }

  /**
   * A card dropped on somebody's name puts them on the whole phase — every
   * working day of it that's on screen, as far as the budget goes. A weekend is
   * never swept in by that: one gets worked deliberately, by dragging across it.
   */
  function dropOnPerson(target: Target, person: Person) {
    setError(null);
    // The warehouse has no window of its own, so "the whole card" means every
    // working day on screen — a weekend is only ever worked deliberately.
    const span =
      target === WAREHOUSE
        ? rangeDays.filter((d) => isWorkingDay(d, calendar))
        : (cardByTask.get(target)?.days ?? []);
    const days = span.filter((d) => !isOn(target, d, person));
    if (days.length === 0) {
      setError(
        target === WAREHOUSE
          ? `${person.name} is already in the warehouse every day in view.`
          : `${person.name} is already on every day of ${cardByTask.get(target)?.task.name} in view.`
      );
      return;
    }
    bookDays(target, person, days);
  }

  function removeFrom(target: Target, day: string, person: Person) {
    setError(null);
    unbookDays(target, person, [day]);
  }

  /**
   * Open a job's card. Clicking a booking on the grid opens it on that person's
   * day: the question being asked is "what is this, and what time do we start",
   * and taking somebody off a day is the × on the card instead.
   */
  function openCard(taskId: number, focus: CardFocus | null = null) {
    setOpened({ taskId, focus });
  }

  /**
   * Which day of a multi-day card the pointer is over. A card drawn across three
   * columns is still three days underneath, so grabbing it stretches from the
   * day under the hand and opening it lands on that day.
   */
  function dayUnder(e: { clientX: number; currentTarget: HTMLElement }, span: DaySpan): string {
    const rect = e.currentTarget.getBoundingClientRect();
    const n = span.endIdx - span.startIdx + 1;
    if (n <= 1 || rect.width <= 0) return columns[span.startIdx];
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * n);
    return columns[span.startIdx + Math.min(n - 1, Math.max(0, i))];
  }

  function startDrag(e: DragEvent<HTMLDivElement>, target: Target, label: string) {
    // Firefox only starts a drag once some data is set, so both a typed payload
    // and a plain-text fallback go on.
    e.dataTransfer.setData(DRAG_TYPE, String(target));
    e.dataTransfer.setData('text/plain', label);
    e.dataTransfer.effectAllowed = 'copy';
    setDragging(target);
    setPicked(target);
  }

  function endDrag() {
    setDragging(null);
    setOver(null);
  }

  /** Accept a drop only where the dragged phase could actually be booked. */
  function allowDrop(e: DragEvent, key: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (over !== key) setOver(key);
  }

  /** The days a stretch-drag currently covers, in order. */
  function rangeDaysCovered(drag: RangeDrag): string[] {
    const [a, b] = drag.from <= drag.to ? [drag.from, drag.to] : [drag.to, drag.from];
    return columns.filter((d) => d >= a && d <= b);
  }

  /** Is this cell inside the stretch being dragged out right now? */
  function inRange(personKey: string, day: string): boolean {
    if (!range || range.personKey !== personKey) return false;
    const [a, b] = range.from <= range.to ? [range.from, range.to] : [range.to, range.from];
    return day >= a && day <= b;
  }

  /**
   * Let go of a stretch-drag and book it. A press and release on the same cell
   * is a click, not a stretch — the cell's own click handler has that, so this
   * only acts once the drag has actually covered more than one day.
   */
  useEffect(() => {
    if (!range) return;
    const drag = range;
    function finish() {
      setRange(null);
      const person = people.find((p) => p.key === drag.personKey);
      if (!person) return;
      if (drag.target !== WAREHOUSE && !cardByTask.has(drag.target)) return;
      const covered = rangeDaysCovered(drag);
      if (covered.length < 2) return;
      const days = covered.filter(
        (d) => takesDay(drag.target, d, person) && !isOn(drag.target, d, person)
      );
      if (days.length === 0) {
        setError(
          drag.target === WAREHOUSE
            ? `Nothing to book there — ${person.name} is already in the warehouse on those days.`
            : `Nothing to book there — ${person.name} is already on those days of ${
                cardByTask.get(drag.target)?.task.name
              }, or the phase doesn't run then.`
        );
        return;
      }
      bookDays(drag.target, person, days);
    }
    document.addEventListener('mouseup', finish);
    return () => document.removeEventListener('mouseup', finish);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, cardByTask, people, columns]);

  return (
    <div className={`space-y-3 ${range ? 'select-none' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-black/10">
          {/* One week per press, whether one week or two are on screen. A
              fortnight that paged a fortnight at a time skipped the week in
              between: the arrows slide the window, they don't jump it. */}
          <button
            className="px-3 py-2 text-sm font-medium text-brand-gray hover:bg-black/5"
            onClick={() => setAnchor(addDays(rangeFrom, -7))}
            aria-label="Back one week"
            title="Back one week"
          >
            ‹
          </button>
          <button
            className="border-x border-black/10 px-3 py-2 text-sm font-medium text-brand-ink hover:bg-black/5"
            onClick={() => setAnchor(weekStart(today()))}
            title="Jump back to the week containing today"
          >
            This Week
          </button>
          <button
            className="px-3 py-2 text-sm font-medium text-brand-gray hover:bg-black/5"
            onClick={() => setAnchor(addDays(rangeFrom, 7))}
            aria-label="Forward one week"
            title="Forward one week"
          >
            ›
          </button>
        </div>

        <div className="flex overflow-hidden rounded-lg border border-black/10">
          {SPANS.map((s) => (
            <button
              key={s.weeks}
              onClick={() => setWeeks(s.weeks)}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                weeks === s.weeks
                  ? 'bg-brand-green font-semibold text-brand-ink'
                  : 'text-brand-gray hover:bg-black/5'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Weekends are off the grid until somebody needs one — a fortnight
            stays ten columns wide, and a weekend on the plan is a decision
            rather than a default. */}
        <button
          onClick={() => setShowWeekends((v) => !v)}
          aria-pressed={showWeekends}
          title={
            showWeekends
              ? 'Hide Saturday and Sunday again (a weekend somebody is booked on stays on the grid)'
              : 'Show Saturday and Sunday so a weekend can be staffed'
          }
          className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
            showWeekends
              ? 'border-brand-green bg-brand-green font-semibold text-brand-ink'
              : 'border-black/10 text-brand-gray hover:bg-black/5'
          }`}
        >
          {showWeekends ? 'Weekends shown' : 'Show weekends'}
        </button>

        <p className="text-sm font-semibold text-brand-ink">
          {heading}
          <span className="ml-2 font-normal text-brand-gray">
            {bookedPeople === 0
              ? 'nobody booked'
              : `${bookedPeople} ${bookedPeople === 1 ? 'person' : 'people'} booked`}
            {understaffed > 0 &&
              ` · ${understaffed} ${understaffed === 1 ? 'phase still needs' : 'phases still need'} crew`}
            {workedOffDays.length > 0 &&
              ` · ${workedOffDays.length} ${
                workedOffDays.length === 1 ? 'weekend day' : 'weekend days'
              } worked`}
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <input
          className="input h-9 w-full max-w-[260px] py-1 text-sm"
          placeholder="Search job, phase, customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-brand-ink">
          <input
            type="checkbox"
            checked={onlyShort}
            onChange={(e) => setOnlyShort(e.target.checked)}
          />
          Only phases still needing crew
        </label>
        <label className="ml-auto flex items-center gap-2 text-sm text-brand-ink">
          <input
            type="checkbox"
            checked={showIdle}
            onChange={(e) => setShowIdle(e.target.checked)}
          />
          Show everyone
        </label>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className={`card min-w-0 overflow-hidden ${draft.saving ? 'opacity-90' : ''}`}>
        <div className="overflow-x-auto">
          <div style={{ minWidth: `${gridMinWidth}px` }}>
            {/* The work to be staffed, sitting over the weeks it belongs to: a
                phase's card is in the column of the week it starts in, so the
                week you're looking at is the week whose work is above it. */}
            <div
              className="grid border-b border-black/10 bg-black/[.02]"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <div className="sticky left-0 z-20 space-y-1.5 bg-[#fafafa] px-2 py-2">
                <div className="px-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">
                    Work to staff
                  </p>
                  {/* Finished phases are counted apart: they're on the band to
                      say what ran that week, not because there's anything to
                      staff. */}
                  <p className="text-[11px] text-brand-ink">
                    {bandLive} {bandLive === 1 ? 'phase' : 'phases'}
                    {bandFinished > 0 && (
                      <span className="text-brand-gray"> · {bandFinished} finished</span>
                    )}
                  </p>
                </div>
                {/* The one card that is never filed under a week: the warehouse
                    is always there, whatever weeks are on screen. */}
                <WarehouseTile
                  picked={picked === WAREHOUSE}
                  dragging={dragging === WAREHOUSE}
                  booked={warehouseInView}
                  onPick={() => setPicked(picked === WAREHOUSE ? null : WAREHOUSE)}
                  onDragStart={(e) => startDrag(e, WAREHOUSE, 'Warehouse')}
                  onDragEnd={endDrag}
                />
              </div>
              {cards.length === 0 || bandCards.length === 0 ? (
                <div
                  style={{ gridColumn: `2 / ${columns.length + 2}` }}
                  className="border-l border-black/10 px-3 py-4 text-center text-xs text-brand-gray"
                >
                  {cards.length === 0
                    ? 'Nothing runs in these weeks. Plan work on the Job Timeline and its card appears here.'
                    : 'No phase matches. Clear the search, or untick the filter.'}
                </div>
              ) : (
                bands.map((b) => {
                  const list = cardsByWeek.get(b.monday) ?? [];
                  return (
                    <div
                      key={b.monday}
                      style={{ gridColumn: `${b.startIdx + 2} / ${b.startIdx + b.span + 2}` }}
                      className="border-l border-black/10 p-1.5"
                    >
                      <p
                        className={`px-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wide ${
                          b.monday === weekStart(now) ? 'text-brand-green-dark' : 'text-brand-gray'
                        }`}
                      >
                        Starts week of {mondayLabel(b.monday)}
                        {list.length > 0 && ` · ${list.length}`}
                      </p>
                      {list.length === 0 ? (
                        <p className="px-0.5 pb-1 text-[10px] text-brand-gray/70">
                          Nothing starts this week
                        </p>
                      ) : (
                        <div className="flex max-h-[268px] flex-wrap items-start gap-1.5 overflow-y-auto pr-0.5">
                          {list.map((c) => (
                            <PhaseTile
                              key={c.task.id}
                              card={c}
                              picked={picked === c.task.id}
                              dragging={dragging === c.task.id}
                              startedEarlier={c.window.start < rangeFrom}
                              onPick={() => setPicked(picked === c.task.id ? null : c.task.id)}
                              onOpen={() => openCard(c.task.id)}
                              onDragStart={(e) =>
                                startDrag(
                                  e,
                                  c.task.id,
                                  `${c.task.project_name} — ${c.task.name}`
                                )
                              }
                              onDragEnd={endDrag}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Week band: each week's Monday, held across that week's columns. */}
            <div
              className="grid border-b border-black/10 bg-black/[.04]"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <div className="sticky left-0 z-20 bg-[#f4f4f4] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-gray">
                Crew
              </div>
              {bands.map((b) => (
                <div
                  key={b.monday}
                  style={{ gridColumn: `${b.startIdx + 2} / ${b.startIdx + b.span + 2}` }}
                  className={`border-l border-black/10 px-2 py-1 text-[11px] font-semibold ${
                    b.monday === weekStart(now) ? 'text-brand-green-dark' : 'text-brand-gray'
                  }`}
                  title={`Week of ${shortDate(b.monday)}`}
                >
                  Week of {mondayLabel(b.monday)}
                </div>
              ))}
            </div>

            {/* Day header */}
            <div
              className="grid border-b border-black/10 bg-black/[.02]"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <div className="sticky left-0 z-20 bg-[#fafafa] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-gray">
                Employee
              </div>
              {columns.map((d) => {
                const off = !isWorkingDay(d, calendar);
                const worked = off && workedOffDays.includes(d);
                return (
                  <div
                    key={d}
                    className={`px-2 py-1.5 text-[11px] font-semibold ${weekEdge(d)} ${
                      d === now
                        ? 'text-brand-green-dark'
                        : worked
                          ? 'text-amber-700'
                          : off
                            ? 'text-brand-gray/60'
                            : 'text-brand-gray'
                    }`}
                  >
                    {DAY_LABELS[fromDay(d).getDay()]} {fromDay(d).getDate()}
                    {off && <span className="ml-1 font-normal">{worked ? '(worked)' : '(off)'}</span>}
                  </div>
                );
              })}
            </div>

            {sections.map((section) => (
              <Fragment key={section.id}>
                {/* Subs get a heading of their own rather than a tail on the
                    crew list. They book the same way, but they answer a
                    different question — which subs are on site this week — and
                    on a phase one holds outright there is nothing to book at
                    all: their days come with the contract. */}
                {section.id === 'subs' && (
                  <div
                    className="grid border-y border-black/10 bg-black/[.04]"
                    style={{ gridTemplateColumns: gridTemplate }}
                  >
                    <div className="sticky left-0 z-20 truncate bg-[#f4f4f4] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-gray">
                      Subcontractor
                    </div>
                  </div>
                )}
                {section.rows.length === 0 ? (
                  <div className="px-3 py-6 text-center">
                    {section.id === 'crew' ? (
                      <>
                        <p className="font-semibold text-brand-ink">Nobody to show</p>
                        <p className="mt-1 text-sm text-brand-gray">
                          Nobody is booked for {heading}. Tick &ldquo;Show everyone&rdquo; to see
                          the whole crew.
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-brand-gray">
                        {subs.length === 0
                          ? 'No subcontractors yet — add them under Settings → Subcontractors.'
                          : `No subcontractor is booked for ${heading}. Tick “Show everyone” to see them all.`}
                      </p>
                    )}
                  </div>
                ) : (
                  section.rows.map((p) => {
                    const rowKey = `${p.key}|row`;
                    // Dropping on a name means "put them on this phase" — only
                    // offered while a phase with room is actually being dragged.
                    const rowTakes =
                      active != null &&
                      dragging != null &&
                      (activeWarehouse
                        ? p.kind === 'user'
                        : !!activeCard && activeCard.days.some((d) => canTake(activeCard, d, p)));
                    return (
                      <div
                        key={p.key}
                        className="grid border-b border-black/5 last:border-0"
                        // A lane per stacked card, so a booking drawn across three
                        // days sits in one row of its own and the day cells behind
                        // it stretch the whole height.
                        style={{
                          gridTemplateColumns: gridTemplate,
                          gridTemplateRows: `repeat(${Math.max(1, p.lanes)}, minmax(0, auto))`,
                        }}
                      >
                        <div
                          style={{ gridRow: '1 / -1' }}
                          className={`sticky left-0 z-20 bg-white px-3 py-1.5 ${
                            rowTakes ? 'cursor-copy ring-1 ring-inset ring-brand-green/50' : ''
                          } ${over === rowKey && rowTakes ? 'bg-brand-green/15' : ''}`}
                          onDragOver={rowTakes ? (e) => allowDrop(e, rowKey) : undefined}
                          onDragLeave={rowTakes ? () => setOver(null) : undefined}
                          onDrop={
                            rowTakes
                              ? (e) => {
                                  e.preventDefault();
                                  dropOnPerson(active!, p);
                                  endDrag();
                                }
                              : undefined
                          }
                          title={
                            !rowTakes
                              ? undefined
                              : activeWarehouse
                                ? `Put ${p.name} in the warehouse for every working day on screen`
                                : `Put ${p.name} on ${activeCard!.task.name} for every working day of it on screen`
                          }
                        >
                          <p className="flex items-baseline justify-between gap-1">
                            <span className="truncate text-[13px] font-medium text-brand-ink">
                              {p.name}
                            </span>
                            <span
                              className={`shrink-0 text-[11px] font-semibold ${
                                p.clashes.length > 0
                                  ? 'text-red-700'
                                  : p.bookedCount === 0
                                    ? 'text-brand-gray/60'
                                    : 'text-brand-gray'
                              }`}
                            >
                              {p.bookedCount === 0 ? '—' : `${p.bookedCount}d`}
                            </span>
                          </p>
                          <p className="truncate text-[10px] uppercase tracking-wide text-brand-gray">
                            {p.detail}
                            {!p.schedulable && (
                              <span
                                className="text-amber-700"
                                title="Taken out of scheduling under Settings → Users — shown because they're still booked here"
                              >
                                {' '}
                                · not scheduled
                              </span>
                            )}
                            {p.clashes.length > 0 ? (
                              <span className="text-red-700"> · double-booked</span>
                            ) : (
                              p.splits.length > 0 && (
                                <span
                                  className="text-amber-700"
                                  title="Two jobs in a day, on hours that clear each other"
                                >
                                  {' '}
                                  · split {p.splits.length === 1 ? 'day' : 'days'}
                                </span>
                              )
                            )}
                          </p>
                        </div>

                        {/* The day cells: the booking surface, behind the cards.
                            Each one is the full height of the row, so a person with
                            two cards stacked still has one clickable Wednesday. */}
                        {columns.map((d, i) => {
                          const items = p.days.get(d) ?? [];
                          const off = !isWorkingDay(d, calendar);
                          const clash = clashing(items);
                          const split = !clash && splitting(items);
                          const cellKey = `${p.key}|${d}`;
                          const on = active != null && isOn(active, d, p);
                          // A cell takes the active card when that phase runs that
                          // day and still has budget — or when it's already booked
                          // there, so clicking again takes them off. The warehouse
                          // takes any day of any of our own people.
                          const takes = active != null && takesDay(active, d, p);
                          const dropping = !!dragging && takes && !on;
                          const stretching = inRange(p.key, d);
                          // The sub carrying a phase is on it by contract, not by
                          // booking — there's no day here to give or take.
                          const contractedHere =
                            !!activeCard &&
                            p.kind === 'sub' &&
                            activeCard.task.subcontractor_id === p.refId;
                          return (
                            <div
                              key={d}
                              style={{ gridColumn: i + 2, gridRow: '1 / -1' }}
                              className={`min-h-[42px] p-1 ${weekEdge(d)} ${
                                d === now ? 'bg-brand-green/5' : off ? 'bg-black/[.04]' : ''
                              } ${clash ? 'bg-red-50' : split ? 'bg-amber-50/60' : ''} ${
                                takes && !dragging
                                  ? 'cursor-pointer ring-1 ring-inset ring-brand-green/40 hover:bg-brand-green/10'
                                  : ''
                              } ${dropping ? 'cursor-copy ring-1 ring-inset ring-brand-green/60' : ''} ${
                                over === cellKey && dropping ? 'bg-brand-green/20' : ''
                              } ${stretching ? 'bg-brand-green/20 ring-1 ring-inset ring-brand-green/60' : ''}`}
                              onClick={takes && !dragging ? () => toggleCell(p, d) : undefined}
                              // Press and drag sideways to stretch the picked phase
                              // over a run of days in one go.
                              onMouseDown={
                                takes && !dragging
                                  ? (e) => {
                                      if (e.button !== 0) return;
                                      e.preventDefault();
                                      setRange({
                                        personKey: p.key,
                                        target: active!,
                                        from: d,
                                        to: d,
                                      });
                                    }
                                  : undefined
                              }
                              onMouseEnter={
                                range && range.personKey === p.key
                                  ? () => setRange({ ...range, to: d })
                                  : undefined
                              }
                              onDragOver={dropping ? (e) => allowDrop(e, cellKey) : undefined}
                              onDragLeave={dropping ? () => setOver(null) : undefined}
                              onDrop={
                                dropping
                                  ? (e) => {
                                      e.preventDefault();
                                      dropOnDay(active!, p, d);
                                      endDrag();
                                    }
                                  : undefined
                              }
                              title={
                                contractedHere
                                  ? `${p.name} has this phase — their days follow it, change it on the timeline`
                                  : !takes
                                    ? undefined
                                    : activeWarehouse
                                      ? on
                                        ? `Take ${p.name} out of the warehouse that day`
                                        : `Put ${p.name} in the warehouse${
                                            off ? ' (a non-working day)' : ''
                                          }\nDrag sideways to book a run of days`
                                      : on
                                        ? `Take ${p.name} off ${activeCard!.task.name}${finishedHint(activeCard!)}`
                                        : `Book ${p.name} on ${activeCard!.task.project_name} — ${activeCard!.task.name}${
                                            off ? ' (a non-working day — an extra day of work)' : ''
                                          }\nDrag sideways to book a run of days${finishedHint(activeCard!)}`
                              }
                            >
                              {takes && !on && items.length === 0 && (
                                <span className="block pt-1 text-center text-[10px] font-medium text-brand-green-dark">
                                  {dragging ? 'drop' : stretching ? '⇢' : '+ book'}
                                </span>
                              )}
                            </div>
                          );
                        })}

                        {/* The cards, over the days they cover. Two days of the same
                            job at the same time is ONE card across both — that's
                            one visit, not two — so the grid reads the way the work
                            actually falls. While a card is being dragged or a run of
                            days stretched, these step out of the way so the day
                            cells underneath take the drop, and a stretch-drag over
                            them reports the day it is on. */}
                        {p.spans.map((s) => {
                          // A const of its own, so which kind of entry it is stays
                          // narrowed inside the handlers below.
                          const entry = s.entry;
                          const first = columns[s.startIdx];
                          const last = columns[s.endIdx];
                          const days = s.endIdx - s.startIdx + 1;
                          const off = !isWorkingDay(first, calendar) || !isWorkingDay(last, calendar);
                          const span = `${shortDate(first)}${days > 1 ? ` – ${shortDate(last)}` : ''}`;
                          return (
                            <div
                              key={`${s.key}:${first}`}
                              style={{
                                gridColumn: `${s.startIdx + 2} / ${s.endIdx + 3}`,
                                gridRow: s.lane + 1,
                              }}
                              className={`relative z-10 min-w-0 px-1 py-0.5 ${
                                dragging ? 'pointer-events-none' : ''
                              }`}
                              // A stretch-drag runs over the cards as well as the
                              // gaps between them, so a card passed over reports
                              // which of its days the hand is on.
                              onMouseMove={
                                range && range.personKey === p.key
                                  ? (e) => {
                                      const day = dayUnder(e, s);
                                      if (day !== range.to) setRange({ ...range, to: day });
                                    }
                                  : undefined
                              }
                            >
                              {entry.kind === 'warehouse' ? (
                                <div className="group relative">
                                  <button
                                    onMouseDown={(e) => {
                                      if (e.button !== 0) return;
                                      e.stopPropagation();
                                      setPicked(WAREHOUSE);
                                      setRange({
                                        personKey: p.key,
                                        target: WAREHOUSE,
                                        from: dayUnder(e, s),
                                        to: dayUnder(e, s),
                                      });
                                    }}
                                    title={`Warehouse · ${span}\nStanding work — no start time of its own\nDrag sideways to put ${p.name} in for more days, or press × to take the ${
                                      days === 1 ? 'day' : 'days'
                                    } off`}
                                    className={`block w-full rounded border-l-[3px] py-0.5 pl-1 pr-4 text-left text-[10px] leading-tight ${WAREHOUSE_CHIP} ${
                                      off ? 'ring-1 ring-amber-300' : ''
                                    }`}
                                    style={{ borderLeftColor: WAREHOUSE_TINT }}
                                  >
                                    <span className="block truncate font-semibold">
                                      Warehouse
                                      {days > 1 && (
                                        <span className="font-normal opacity-70"> · {days}d</span>
                                      )}
                                    </span>
                                  </button>
                                  <RemoveButton
                                    label={`Take ${p.name} out of the warehouse${
                                      days > 1 ? ` for ${span}` : ''
                                    }`}
                                    onRemove={() =>
                                      unbookDays(WAREHOUSE, p, columns.slice(s.startIdx, s.endIdx + 1))
                                    }
                                  />
                                </div>
                              ) : (
                                <div className="group relative">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openCard(entry.task.id, {
                                        day: dayUnder(e, s),
                                        kind: p.kind,
                                        refId: p.refId,
                                        name: p.name,
                                      });
                                    }}
                                    // Grabbing a booking and pulling sideways is how
                                    // one day of a job becomes several.
                                    onMouseDown={(e) => {
                                      if (entry.contracted || e.button !== 0) return;
                                      e.stopPropagation();
                                      setPicked(entry.task.id);
                                      setRange({
                                        personKey: p.key,
                                        target: entry.task.id,
                                        from: dayUnder(e, s),
                                        to: dayUnder(e, s),
                                      });
                                    }}
                                    title={`${entry.task.project_name} — ${entry.task.name}\n${span}${
                                      days > 1 ? ` (${days} days)` : ''
                                    }\n${shiftLabel(entry.shift)}\nClick for the job details, start times and crew notes${
                                      entry.contracted
                                        ? '\nSubcontracted for this phase — their days follow its dates'
                                        : `${
                                            entry.finished
                                              ? '\nThis job is finished — these days are the record of what was worked, and a change to them is confirmed first'
                                              : ''
                                          }\nDrag sideways to put ${p.name} on more days, or press × to take ${
                                            days === 1 ? 'the day' : 'these days'
                                          } off`
                                    }`}
                                    className={`block w-full rounded border-l-[3px] py-0.5 pl-1 text-left text-[10px] leading-tight ${
                                      entry.finished
                                        ? FINISHED_CHIP
                                        : entry.contracted
                                          ? CONTRACTED_CHIP
                                          : STATUS_CHIP[entry.task.status]
                                    } ${entry.contracted ? 'pr-1' : 'pr-4'} ${
                                      off && !entry.contracted && !entry.finished ? 'ring-1 ring-amber-300' : ''
                                    }`}
                                    style={{ borderLeftColor: jobTint(entry.task.project_id) }}
                                  >
                                    {/* Three short lines rather than two crowded
                                        ones: at a fortnight's column width, a start
                                        time sharing a line with the job or the phase
                                        truncates the other one away entirely. */}
                                    {(shiftShort(entry.shift) || days > 1) && (
                                      <span className="flex items-baseline justify-between gap-1 text-[9px] font-bold leading-tight text-brand-green-dark">
                                        <span className="truncate">{shiftShort(entry.shift)}</span>
                                        {days > 1 && (
                                          <span className="shrink-0 font-semibold text-brand-gray">
                                            {days}d
                                          </span>
                                        )}
                                      </span>
                                    )}
                                    <span className="block truncate font-semibold">
                                      {entry.task.project_name}
                                    </span>
                                    <span className="block truncate opacity-90">
                                      {entry.task.name}
                                    </span>
                                  </button>
                                  {/* Taking somebody off is its own small target now
                                      that the card itself opens the job. Nothing to
                                      take off a contracted day — the sub holds the
                                      phase, so their days move with its dates. */}
                                  {!entry.contracted && (
                                    <RemoveButton
                                      label={`Take ${p.name} off ${entry.task.name}${
                                        days > 1 ? ` for ${span}` : ''
                                      }`}
                                      onRemove={() =>
                                        unbookDays(entry.task.id, p, columns.slice(s.startIdx, s.endIdx + 1))
                                      }
                                    />
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })
                )}
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Days carrying more people than the phase asked for. Allowed on purpose
          — the budget is a total — but worth seeing before the weeks go out. */}
      <HeavyDays cards={cards.filter((c) => !c.finished)} />

      {openedCard && (
        <CrewJobCard
          task={openedCard.task}
          window={openedCard.window}
          holidays={holidays}
          publishedVersion={published[openedCard.task.project_id]?.version ?? null}
          draft={draft}
          crewNotes={notesByJob.get(openedCard.task.project_id) ?? []}
          focus={opened?.focus ?? null}
          // A finished job's card is the record of a week that has been worked.
          // It opens editable — a wrong record has to be correctable — with the
          // job flagged on it and every change confirmed first.
          finished={openedCard.finished}
          onClose={() => setOpened(null)}
          onSaved={() => setOpened(null)}
        />
      )}
    </div>
  );
}

/**
 * One job phase as a card small enough that a week's worth of them sit above
 * that week's columns: the job, the phase, when it runs, and — in the size that
 * matters most — how many crew days are still to fill.
 */
function PhaseTile({
  card,
  picked,
  dragging,
  startedEarlier,
  onPick,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  card: PhaseCard;
  picked: boolean;
  dragging: boolean;
  /** True when the phase began before the weeks on screen. */
  startedEarlier: boolean;
  onPick: () => void;
  onOpen: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const { task, window, budget } = card;
  // A phase a sub covers outright asks for none of our crew: nothing to drag
  // onto anybody, so the card reports who was on it instead. A finished phase
  // still drags — its days can be corrected, and every change asks first.
  const staffable = budget.capacity > 0;
  const subName = task.subcontractor_name;
  return (
    <div
      draggable={staffable}
      onDragStart={staffable ? onDragStart : undefined}
      onDragEnd={staffable ? onDragEnd : undefined}
      onClick={staffable ? onPick : undefined}
      role={staffable ? 'button' : undefined}
      tabIndex={staffable ? 0 : undefined}
      aria-pressed={staffable ? picked : undefined}
      onKeyDown={
        staffable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPick();
              }
            }
          : undefined
      }
      title={`${task.project_name} — ${task.name}\n${task.customer}\n${shortDate(window.start)} – ${shortDate(
        window.end
      )}\n${
        !staffable
          ? `${subName ?? 'A subcontractor'} covers this phase — nothing of ours to book`
          : `${budget.filled} of ${budget.capacity} crew days booked\nDrag onto a day, or onto a name for the whole phase${
              card.finished
                ? '\nThis job is finished — its days are the record of what was worked, so a change to them is confirmed first'
                : ''
            }`
      }`}
      className={`min-w-0 grow basis-[148px] rounded-md border border-l-[3px] bg-white p-1.5 text-left transition-shadow ${
        staffable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default border-dashed'
      } ${picked ? 'border-brand-green ring-1 ring-brand-green' : 'border-black/10 hover:shadow-sm'} ${
        dragging ? 'opacity-50' : ''
      } ${staffable && budget.full ? 'bg-brand-green/[.04]' : ''} ${
        card.finished ? 'bg-black/[.02] opacity-75' : ''
      }`}
      style={{ borderLeftColor: picked ? undefined : jobTint(task.project_id) }}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-tight text-brand-ink">
          {task.project_name}
        </p>
        {/* The job's own card: what the work is, the days it runs, the shift
            and the crew notes. */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          title="Job details, start times and notes"
          aria-label={`Job details, start times and notes for ${task.name}`}
          className="-mt-0.5 shrink-0 rounded px-1 text-[11px] leading-none text-brand-gray hover:bg-black/5 hover:text-brand-ink"
        >
          ⋯
        </button>
      </div>
      <p className="truncate text-[10px] leading-tight text-brand-gray">{task.name}</p>
      {/* The job is parked waiting on somebody else. Said on the card rather
          than left to the timeline: this is where the week gets staffed, and
          booking four people onto work that can't start yet is the mistake. */}
      {task.project_on_hold && !card.finished && (
        <p
          className="truncate text-[10px] font-semibold leading-tight text-amber-800"
          title={
            task.project_on_hold_reason
              ? `On hold — waiting on ${task.project_on_hold_reason}`
              : 'On hold'
          }
        >
          On hold{task.project_on_hold_reason ? ` · ${task.project_on_hold_reason}` : ''}
        </p>
      )}
      {subName && (
        <p className="truncate text-[10px] font-medium leading-tight text-brand-ink">
          Sub: {subName}
        </p>
      )}
      <div className="mt-1 flex items-end justify-between gap-1">
        <div className="min-w-0">
          <p className="truncate text-[10px] leading-tight text-brand-gray">
            {mondayLabel(window.start)} – {mondayLabel(window.end)}
            {(task.start_time || task.hours != null) &&
              ` · ${shiftLabel({ startTime: task.start_time, hours: task.hours })}`}
          </p>
          <p className="truncate text-[10px] leading-tight text-brand-gray/80">
            {card.finished
              ? `finished · ${budget.filled} crew ${budget.filled === 1 ? 'day' : 'days'} worked`
              : staffable
                ? `${subName ? 'plus ' : ''}${budget.needed}/day · ${budget.days} ${
                    budget.days === 1 ? 'day' : 'days'
                  }`
                : `on site all ${budget.days} ${budget.days === 1 ? 'day' : 'days'}`}
          </p>
        </div>
        {staffable && !card.finished && (
          <div className="shrink-0 text-right">
            <p
              className={`text-[13px] font-bold leading-none ${
                budget.remaining === 0 ? 'text-brand-green-dark' : 'text-amber-700'
              }`}
            >
              {budget.remaining === 0 ? budget.capacity : budget.remaining}
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-wide text-brand-gray">
              {budget.remaining === 0 ? 'staffed' : 'to fill'}
            </p>
          </div>
        )}
      </div>
      {/* Filed under the first week on screen because it began before it — said
          out loud, so its card isn't read as work starting this week. */}
      {startedEarlier && (
        <p
          className={`truncate text-[9px] font-medium leading-tight ${
            card.finished ? 'text-brand-gray' : 'text-amber-700'
          }`}
        >
          Started {mondayLabel(window.start)}
        </p>
      )}
      {staffable && !card.finished && (
        <BudgetBar filled={budget.filled} capacity={budget.capacity} />
      )}
    </div>
  );
}

/**
 * The standing warehouse card.
 *
 * It sits in the band's own corner rather than under a week, because it doesn't
 * start in one: the warehouse is work that is always available, so the card is
 * in the same place whatever fortnight is on screen. There is no budget to
 * count down and nothing to open — only who is in there, and for how many days
 * of the weeks in view.
 */
function WarehouseTile({
  picked,
  dragging,
  booked,
  onPick,
  onDragStart,
  onDragEnd,
}: {
  picked: boolean;
  dragging: boolean;
  /** Warehouse days booked across the weeks on screen. */
  booked: number;
  onPick: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onPick}
      role="button"
      tabIndex={0}
      aria-pressed={picked}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick();
        }
      }}
      title={`Warehouse\nStanding work — always here, never full\n${
        booked === 0 ? 'Nobody in the warehouse in these weeks' : `${booked} warehouse ${booked === 1 ? 'day' : 'days'} booked in these weeks`
      }\nDrag onto a day, or onto a name for every working day on screen`}
      className={`min-w-0 cursor-grab rounded-md border border-l-[3px] bg-white p-1.5 text-left transition-shadow active:cursor-grabbing ${
        picked ? 'border-brand-green ring-1 ring-brand-green' : 'border-black/10 hover:shadow-sm'
      } ${dragging ? 'opacity-50' : ''}`}
      style={{ borderLeftColor: picked ? undefined : WAREHOUSE_TINT }}
    >
      <p className="truncate text-[11px] font-semibold leading-tight text-brand-ink">Warehouse</p>
      <p className="truncate text-[10px] leading-tight text-brand-gray">Standing work</p>
      <p className="truncate text-[10px] leading-tight text-brand-gray/80">
        {booked === 0 ? 'nobody in these weeks' : `${booked} ${booked === 1 ? 'day' : 'days'} booked`}
      </p>
    </div>
  );
}

/**
 * A day's live entries as the clash rules want them: a job id and a shift.
 *
 * Days on a finished job are dropped: they're a record of a week already
 * worked, so flagging them would paint every week already worked red. Warehouse
 * days are dropped too — standing work has no hours of its own, so it can't
 * collide with the job somebody drives to afterwards.
 */
function shiftItems(items: DayEntry[]): { projectId: number; shift: DayShift }[] {
  return items
    .filter((b) => b.kind === 'phase' && !b.finished)
    .map((b) => {
      const phase = b as Extract<DayEntry, { kind: 'phase' }>;
      return { projectId: phase.task.project_id, shift: phase.shift };
    });
}

/**
 * Is this day double-booked — the same person on two different live jobs whose
 * HOURS collide? Two all-day bookings always do; a morning on one job and an
 * afternoon on another doesn't, and reads as a split day instead.
 */
function clashing(items: DayEntry[]): boolean {
  return dayIsClashing(shiftItems(items));
}

/** Is this day one person deliberately split between jobs, on hours that clear? */
function splitting(items: DayEntry[]): boolean {
  return dayIsSplit(shiftItems(items));
}

/**
 * The line a tooltip carries when the job behind it is over: the days are still
 * editable, but they are a record, and changing one asks first.
 */
function finishedHint(card: PhaseCard): string {
  return card.finished
    ? '\nThis job is finished — a change to its days changes the record of what was worked, and is confirmed first'
    : '';
}

/** Monday reads as the start of a week, so its column carries a heavier rule. */
function weekEdge(day: string): string {
  return fromDay(day).getDay() === 1 ? 'border-l border-black/20' : 'border-l border-black/5';
}

/**
 * The × in the corner of a card that takes somebody off it.
 *
 * Clicking a card opens the job, so removing a booking is its own small target
 * rather than a side effect of a click somebody meant as "what is this?". It
 * shows on hover and on keyboard focus, and stays visible on touch, where there
 * is no hover to reveal it with.
 */
function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white/95 text-[9px] font-bold leading-none text-brand-gray opacity-0 shadow-sm ring-1 ring-black/10 transition-opacity hover:bg-red-100 hover:text-red-700 focus:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
    >
      ×
    </button>
  );
}

/** How much of a phase's crew budget is spent, as a bar. */
function BudgetBar({ filled, capacity }: { filled: number; capacity: number }) {
  const pct = capacity === 0 ? 0 : Math.min(100, (filled / capacity) * 100);
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-black/10">
      <div
        className={`h-full rounded-full ${filled >= capacity ? 'bg-brand-green' : 'bg-status-progress'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * Phases with a day carrying more people than they were planned for. Not an
 * error — spending a budget unevenly is the point — but a heavy Monday is
 * usually a decision somebody made, and worth being able to see.
 */
function HeavyDays({
  cards,
}: {
  cards: { task: ScheduleTaskRow; budget: { needed: number }; byDay: Map<string, unknown[]> }[];
}) {
  const heavy = cards.flatMap((c) =>
    [...c.byDay.entries()]
      .filter(([, crew]) => crew.length > c.budget.needed)
      .map(([day, crew]) => ({
        task: c.task,
        day,
        count: crew.length,
        needed: c.budget.needed,
      }))
  );
  if (heavy.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">
        {heavy.length === 1 ? '1 heavy day' : `${heavy.length} heavy days`}
      </p>
      <ul className="mt-1 space-y-0.5 text-sm text-amber-800">
        {heavy.map((h) => (
          <li key={`${h.task.id}-${h.day}`}>
            <strong>{h.task.project_name}</strong> — {h.task.name} has {h.count} on{' '}
            {shortDate(h.day)}, planned for {h.needed} a day. The phase&apos;s total is still
            within budget.
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A stable colour per job, keyed off its id — the stripe down the left of every
 * card and every booking. At a fortnight's column width a job name truncates to
 * a few characters, so the colour is what actually says "these two bookings are
 * the same job" across ten columns and six people. Status stays the fill.
 */
const JOB_TINTS = ['#1f6feb', '#2f7d32', '#b45309', '#7c3aed', '#0f766e', '#be123c'] as const;

function jobTint(projectId: number): string {
  return JOB_TINTS[Math.abs(projectId) % JOB_TINTS.length];
}

/**
 * The warehouse's own colour, kept out of the job palette on purpose: a
 * warehouse day is the one chip on the grid that isn't a customer's job.
 */
const WAREHOUSE_TINT = '#475569';

const WAREHOUSE_CHIP =
  'bg-slate-100 text-slate-700 hover:bg-red-100 hover:text-red-700';

/**
 * A day on a job that is over. Muted rather than tinted by status: it reads as
 * the record of a week that was worked rather than as work still to come. It is
 * still editable — a wrong record has to be fixable — with a confirmation on
 * the way in.
 */
const FINISHED_CHIP =
  'border border-black/10 bg-black/[.03] text-brand-gray opacity-90 hover:bg-red-50';

/** A sub's day that comes from holding the phase, not from being booked on it. */
const CONTRACTED_CHIP =
  'cursor-default border border-dashed border-brand-gray/40 bg-brand-gray/5 text-brand-ink';

const STATUS_CHIP: Record<ScheduleTaskRow['status'], string> = {
  not_started: 'bg-brand-gray/15 text-brand-ink hover:bg-red-100 hover:text-red-700',
  in_progress: 'bg-status-progress/20 text-brand-ink hover:bg-red-100 hover:text-red-700',
  complete: 'bg-brand-green/20 text-brand-green-dark hover:bg-red-100 hover:text-red-700',
};
