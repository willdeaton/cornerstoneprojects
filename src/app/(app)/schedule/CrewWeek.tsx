'use client';

import { useEffect, useMemo, useState, useTransition, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
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
  startTimeOn,
  timeLabel,
  today,
  weekAlignedRange,
  weekBands,
  weekLabel,
  weekStart,
  dayTimeMap,
  type ComputedWindow,
} from '@/lib/schedule-math';
import type { ScheduleTaskRow } from '@/lib/types';
import {
  assignCrewDayAction,
  assignCrewSpanAction,
  unassignCrewDayAction,
  unassignCrewSpanAction,
} from '@/app/actions/schedule';
import { CrewJobCard, type CardPerson } from './CrewJobCard';
import type { WorkerOption } from './TaskModal';
import type { PublishedInfo } from './PublishBar';

/** One phase a person is booked on for one day. */
type DayEntry = { task: ScheduleTaskRow; startTime: string | null };

/**
 * One person's unbroken run of days on one phase, as the grid draws it: a single
 * bar across the columns it covers rather than a chip repeated in each of them.
 * A gap in the days, or a day that starts at a different time, ends the run — so
 * a bar always means "these days, this job, this start time".
 */
interface Bar {
  task: ScheduleTaskRow;
  /** Index into the visible columns where the bar starts. */
  startIdx: number;
  /** How many columns it covers. */
  span: number;
  /** The days it covers, in order. */
  days: string[];
  startTime: string | null;
  /** Which stacked lane of the row it sits in — two jobs one day means two. */
  lane: number;
}

/**
 * Pack one person's booked days into bars, then into as few lanes as they fit.
 *
 * Runs are built over the VISIBLE columns, so a Friday and the Monday after read
 * as one stretch when the weekend is hidden — which is how the crew reads it —
 * and as two when the weekend is on screen and not worked.
 */
function personBars(days: Map<string, DayEntry[]>, columns: string[]): Bar[] {
  const bars: Bar[] = [];
  const open = new Map<number, Bar>();
  columns.forEach((day, i) => {
    for (const entry of days.get(day) ?? []) {
      const run = open.get(entry.task.id);
      if (run && run.startIdx + run.span === i && run.startTime === entry.startTime) {
        run.span++;
        run.days.push(day);
      } else {
        const bar: Bar = {
          task: entry.task,
          startIdx: i,
          span: 1,
          days: [day],
          startTime: entry.startTime,
          lane: 0,
        };
        bars.push(bar);
        open.set(entry.task.id, bar);
      }
    }
  });

  // First lane the bar fits in, so a single job a day stays one row tall.
  const laneEnds: number[] = [];
  for (const bar of [...bars].sort((a, b) => a.startIdx - b.startIdx)) {
    let lane = laneEnds.findIndex((end) => end <= bar.startIdx);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = bar.startIdx + bar.span;
    bar.lane = lane;
  }
  return bars;
}

/** Widths the crew grid opens at, in whole weeks — two by default. */
const SPANS = [
  { weeks: 1, label: 'Week' },
  { weeks: 2, label: '2 Weeks' },
] as const;

const DEFAULT_WEEKS = 2;

/** What a card being dragged carries. Read on drop; the state drives the hover. */
const DRAG_TYPE = 'application/x-cornerstone-phase';

/** A phase card, as both the work band and the grid need it. */
interface PhaseCard {
  task: ScheduleTaskRow;
  window: ComputedWindow;
  budget: ReturnType<typeof crewBudget>;
  byDay: Map<string, { kind: 'user' | 'sub'; ref_id: number }[]>;
  /** The phase's working days that are on screen — the default days to book. */
  days: string[];
}

interface Person {
  key: string;
  kind: 'user';
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
  taskId: number;
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
 * Weekends are hidden until they matter: tick Weekends (or have somebody booked
 * on one already) and Saturday and Sunday join the grid, bookable like any other
 * day. A weekend worked doesn't spend the weekdays' budget — it brings a day of
 * its own, because it IS an extra day of work.
 *
 * Only our own people have rows. A subcontracted phase is the timeline's
 * business: the sub was engaged there, so they're on site every working day of
 * it and their days follow its dates — nothing to book here. Its card still
 * shows in the work band, saying who covers it, and only the crew we send
 * alongside them, if any, is booked onto anybody's row.
 *
 * The timeline says a phase needs three people for four days; this is where
 * those twelve crew-days get spent. The budget is a total rather than a per-day
 * quota, so four people Monday and one Friday is a legitimate way to cover a
 * 2-crew, 5-day phase — which is how a week usually falls. A day carrying more
 * than the phase asked for is flagged, never blocked.
 */
export function CrewWeek({
  tasks,
  workers,
  holidays,
  published = {},
}: {
  tasks: ScheduleTaskRow[];
  workers: WorkerOption[];
  holidays: string[];
  /** Publish state per job id, so a card can say a change needs a reason. */
  published?: Record<number, PublishedInfo>;
}) {
  const router = useRouter();
  /** How many weeks are on screen — the nav steps by exactly this much. */
  const [weeks, setWeeks] = useState<number>(DEFAULT_WEEKS);
  const [anchor, setAnchor] = useState<string>(() => weekStart(today()));
  const [showIdle, setShowIdle] = useState(true);
  /** Opens Saturday and Sunday up, for the weeks the crew has to work one. */
  const [showWeekends, setShowWeekends] = useState(false);
  /** Narrows the work band to phases still missing crew. */
  const [onlyShort, setOnlyShort] = useState(false);
  /** Free-text filter over the work band — job, phase or customer. */
  const [search, setSearch] = useState('');
  /** The phase picked by click, for booking without a mouse drag. */
  const [picked, setPicked] = useState<number | null>(null);
  /** The phase currently being dragged. */
  const [dragging, setDragging] = useState<number | null>(null);
  /** The cell or name the drag is over: `person|day`, or `person|row`. */
  const [over, setOver] = useState<string | null>(null);
  /** The stretch of days currently being dragged out along one person's row. */
  const [range, setRange] = useState<RangeDrag | null>(null);
  /**
   * The card that's open: a phase on its own, or one person's booking on it —
   * which is the same card, filled in with whose entry it is.
   */
  const [opened, setOpened] = useState<{ taskId: number; person?: CardPerson } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const calendar = useMemo(() => ({ holidays: new Set(holidays) }), [holidays]);
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
      }))
      .sort((a, b) =>
        a.window.start === b.window.start
          ? a.task.project_name.localeCompare(b.task.project_name) ||
            a.task.name.localeCompare(b.task.name)
          : a.window.start < b.window.start
            ? -1
            : 1
      );
  }, [tasks, windows, calendar, rangeDays, rangeFrom, rangeTo]);

  const cardByTask = useMemo(() => new Map(cards.map((c) => [c.task.id, c])), [cards]);
  // Dragging takes over from clicking, so the grid highlights whichever phase
  // the manager is actually working with.
  const activeCard = (dragging ?? picked) != null ? cardByTask.get((dragging ?? picked)!) : undefined;
  const openedCard = opened ? cardByTask.get(opened.taskId) : undefined;

/**
   * Person -> day -> the phases they're on that day, in view. Our own crew only:
   * a sub's days belong to the contract, and the timeline is where they change.
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
        if (!list.some((e) => e.task.id === entry.task.id)) list.push(entry);
      } else days.set(day, [entry]);
    };

    for (const card of cards) {
      const { task } = card;
      const times = dayTimeMap(task.day_times ?? []);
      for (const c of task.crew_days ?? []) {
        if (c.kind !== 'user') continue;
        if (c.day < rangeFrom || c.day > rangeTo) continue;
        add(`user:${c.ref_id}`, c.day, {
          task,
          startTime: startTimeOn(c.day, task.start_time, times),
        });
      }
    }
    return out;
  }, [cards, rangeFrom, rangeTo]);

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
    const rows: Person[] = workers.map((w) => ({
      key: `user:${w.id}`,
      kind: 'user' as const,
      refId: w.id,
      name: w.name,
      detail: w.role,
      schedulable: w.schedulable !== false,
    }));
    return rows
      .map((p) => {
        const days = byPerson.get(p.key) ?? new Map<string, DayEntry[]>();
        const booked = columns.filter((d) => (days.get(d)?.length ?? 0) > 0);
        // Two different jobs on one day is a real double-booking; two phases of
        // the same job is just one crew doing two things there.
        const clashes = columns.filter(
          (d) => new Set((days.get(d) ?? []).map((b) => b.task.project_id)).size > 1
        );
        const bars = personBars(days, columns);
        return {
          ...p,
          days,
          bars,
          // Bars stack when somebody is on two jobs the same day, so the row is
          // as tall as it has to be and no taller.
          lanes: Math.max(1, ...bars.map((b) => b.lane + 1)),
          bookedCount: booked.length,
          clashes,
        };
      })
      // Somebody taken out of scheduling under Settings -> Users isn't offered
      // here at all — unless they're already booked in view, in which case
      // hiding them would quietly drop a name off a schedule the crew has.
      .filter((p) => p.schedulable || p.bookedCount > 0)
      .filter((p) => showIdle || p.bookedCount > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [workers, byPerson, columns, showIdle]);

  // Day columns share whatever width is left rather than claiming a fixed one,
  // so a whole fortnight fits beside the names instead of scrolling out of
  // sight. Chips truncate and carry the full job on hover; the Week view is
  // where a narrow screen goes for detail.
  const gridTemplate = `minmax(112px, 150px) repeat(${columns.length}, minmax(0, 1fr))`;
  const gridMinWidth = columns.length > 7 ? 880 : 660;
  const bookedPeople = people.filter((p) => p.bookedCount > 0).length;
  const understaffed = cards.filter((c) => c.budget.remaining > 0).length;
  const needle = search.trim().toLowerCase();
  const bandCards = cards
    .filter((c) => !onlyShort || c.budget.remaining > 0)
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
  const heading = weeks === 1 ? weekLabel(rangeFrom) : rangeLabel(rangeFrom, rangeTo);
  /** Weekend and holiday days somebody is actually booked on, in view. */
  const workedOffDays = columns.filter(
    (d) =>
      !isWorkingDay(d, calendar) &&
      [...byPerson.values()].some((days) => (days.get(d)?.length ?? 0) > 0)
  );

  function refresh() {
    startTransition(() => router.refresh());
  }

  /** Is this person already on this phase that day? */
  function isBooked(card: PhaseCard, day: string, person: Person): boolean {
    return (card.byDay.get(day) ?? []).some(
      (c) => c.kind === person.kind && c.ref_id === person.refId
    );
  }

  /** A phase with crew of ours to book — a subcontracted one may have none. */
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
   * A day this phase can take crew on: inside the phase's window and not already
   * full. Weekends count, which is how a weekend gets worked; they're only ever
   * offered on a column the manager has opened up.
   */
  function canTake(card: PhaseCard, day: string, person: Person): boolean {
    if (!isStaffable(card)) return false;
    if (day < card.window.start || day > card.window.end) return false;
    return isBooked(card, day, person) || hasRoom(card, day);
  }

  /** Book the picked phase onto one person's day, or take them back off it. */
  function toggleCell(person: Person, day: string) {
    if (!activeCard) return;
    setError(null);
    const already = isBooked(activeCard, day, person);
    startTransition(async () => {
      const args = { task_id: activeCard.task.id, day, kind: person.kind, ref_id: person.refId };
      const res = already ? await unassignCrewDayAction(args) : await assignCrewDayAction(args);
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Could not change that booking.');
    });
  }

  /** A card dropped on one day cell books that one day. */
  function dropOnDay(card: PhaseCard, person: Person, day: string) {
    setError(null);
    if (isBooked(card, day, person)) return; // Dropping where they already are is a no-op.
    startTransition(async () => {
      const res = await assignCrewDayAction({
        task_id: card.task.id,
        day,
        kind: person.kind,
        ref_id: person.refId,
      });
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Could not book that day.');
    });
  }

  /** Book one person across a run of days of one phase in a single pass. */
  function bookSpan(card: PhaseCard, person: Person, days: string[]) {
    setError(null);
    startTransition(async () => {
      const res = await assignCrewSpanAction({
        task_id: card.task.id,
        days,
        kind: person.kind,
        ref_id: person.refId,
      });
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Could not book those days.');
    });
  }

  /**
   * A card dropped on somebody's name puts them on the whole phase — every
   * working day of it that's on screen, as far as the budget goes. A weekend is
   * never swept in by that: one gets worked deliberately, by dragging across it.
   */
  function dropOnPerson(card: PhaseCard, person: Person) {
    setError(null);
    const days = card.days.filter((d) => !isBooked(card, d, person));
    if (days.length === 0) {
      setError(`${person.name} is already on every day of ${card.task.name} in view.`);
      return;
    }
    bookSpan(card, person, days);
  }

  /**
   * The ✕ on a booking: take the person off the whole stretch it covers, since
   * that's the thing being pointed at. A single day goes without ceremony; more
   * than one is confirmed, because it's several days of somebody's week.
   */
  function removeBar(bar: Bar, person: Person) {
    setError(null);
    if (
      bar.days.length > 1 &&
      !confirm(
        `Take ${person.name} off ${bar.task.name} for all ${bar.days.length} days (${shortDate(
          bar.days[0]
        )} – ${shortDate(bar.days[bar.days.length - 1])})?`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res =
        bar.days.length === 1
          ? await unassignCrewDayAction({
              task_id: bar.task.id,
              day: bar.days[0],
              kind: person.kind,
              ref_id: person.refId,
            })
          : await unassignCrewSpanAction({
              task_id: bar.task.id,
              days: bar.days,
              kind: person.kind,
              ref_id: person.refId,
            });
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Could not remove that booking.');
    });
  }

  function startDrag(e: DragEvent<HTMLDivElement>, card: PhaseCard) {
    // Firefox only starts a drag once some data is set, so both a typed payload
    // and a plain-text fallback go on.
    e.dataTransfer.setData(DRAG_TYPE, String(card.task.id));
    e.dataTransfer.setData('text/plain', `${card.task.project_name} — ${card.task.name}`);
    e.dataTransfer.effectAllowed = 'copy';
    setDragging(card.task.id);
    setPicked(card.task.id);
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
      const card = cardByTask.get(drag.taskId);
      const person = people.find((p) => p.key === drag.personKey);
      if (!card || !person) return;
      const covered = rangeDaysCovered(drag);
      if (covered.length < 2) return;
      const days = covered.filter((d) => canTake(card, d, person) && !isBooked(card, d, person));
      if (days.length === 0) {
        setError(
          `Nothing to book there — ${person.name} is already on those days of ${card.task.name}, or the phase doesn't run then.`
        );
        return;
      }
      bookSpan(card, person, days);
    }
    document.addEventListener('mouseup', finish);
    return () => document.removeEventListener('mouseup', finish);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, cardByTask, people, columns]);

  return (
    <div className={`space-y-3 ${range ? 'select-none' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-black/10">
          <button
            className="px-3 py-2 text-sm font-medium text-brand-gray hover:bg-black/5"
            onClick={() => setAnchor(addDays(rangeFrom, -7 * weeks))}
            aria-label={weeks === 1 ? 'Previous week' : 'Earlier weeks'}
          >
            ‹
          </button>
          <button
            className="border-x border-black/10 px-3 py-2 text-sm font-medium text-brand-ink hover:bg-black/5"
            onClick={() => setAnchor(weekStart(today()))}
          >
            This Week
          </button>
          <button
            className="px-3 py-2 text-sm font-medium text-brand-gray hover:bg-black/5"
            onClick={() => setAnchor(addDays(rangeFrom, 7 * weeks))}
            aria-label={weeks === 1 ? 'Next week' : 'Later weeks'}
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

      <div className={`card min-w-0 overflow-hidden ${pending ? 'opacity-70' : ''}`}>
        <div className="overflow-x-auto">
          <div style={{ minWidth: `${gridMinWidth}px` }}>
            {/* The work to be staffed, sitting over the weeks it belongs to: a
                phase's card is in the column of the week it starts in, so the
                week you're looking at is the week whose work is above it. */}
            <div
              className="grid border-b border-black/10 bg-black/[.02]"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <div className="sticky left-0 z-20 bg-[#fafafa] px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-gray">
                  Work to staff
                </p>
                <p className="text-[11px] text-brand-ink">
                  {bandCards.length} {bandCards.length === 1 ? 'phase' : 'phases'}
                </p>
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
                              onOpen={() => setOpened({ taskId: c.task.id })}
                              onDragStart={(e) => startDrag(e, c)}
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

            {people.length === 0 ? (
              <div className="p-10 text-center">
                <p className="font-semibold text-brand-ink">Nobody to show</p>
                <p className="mt-1 text-sm text-brand-gray">
                  Nobody is booked for {heading}. Tick &ldquo;Show everyone&rdquo; to see the whole
                  crew.
                </p>
              </div>
            ) : (
              people.map((p) => {
                const rowKey = `${p.key}|row`;
                // Dropping on a name means "put them on this phase" — only
                // offered while a phase with room is actually being dragged.
                const rowTakes =
                  !!activeCard &&
                  !!dragging &&
                  activeCard.days.some((d) => canTake(activeCard, d, p));
                // Lanes hold the bars; the day cells sit behind all of them, so
                // an empty stretch of somebody's row is still a place to book.
                const lastLane = `1 / ${p.lanes + 1}`;
                return (
                  <div
                    key={p.key}
                    className="grid border-b border-black/5 last:border-0"
                    style={{
                      gridTemplateColumns: gridTemplate,
                      gridTemplateRows: `repeat(${p.lanes}, minmax(0, auto))`,
                    }}
                  >
                    <div
                      style={{ gridRow: lastLane }}
                      className={`sticky left-0 z-30 bg-white px-3 py-1.5 ${
                        rowTakes ? 'cursor-copy ring-1 ring-inset ring-brand-green/50' : ''
                      } ${over === rowKey && rowTakes ? 'bg-brand-green/15' : ''}`}
                      onDragOver={rowTakes ? (e) => allowDrop(e, rowKey) : undefined}
                      onDragLeave={rowTakes ? () => setOver(null) : undefined}
                      onDrop={
                        rowTakes
                          ? (e) => {
                              e.preventDefault();
                              dropOnPerson(activeCard!, p);
                              endDrag();
                            }
                          : undefined
                      }
                      title={
                        rowTakes
                          ? `Put ${p.name} on ${activeCard!.task.name} for every working day of it on screen`
                          : undefined
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
                        {p.clashes.length > 0 && (
                          <span className="text-red-700"> · double-booked</span>
                        )}
                      </p>
                    </div>

                    {/* The day cells: the surface everything is booked on, held
                        behind the bars so a whole row is one target per day. */}
                    {columns.map((d, i) => {
                      const items = p.days.get(d) ?? [];
                      const off = !isWorkingDay(d, calendar);
                      const clash = new Set(items.map((b) => b.task.project_id)).size > 1;
                      const cellKey = `${p.key}|${d}`;
                      const on = !!activeCard && isBooked(activeCard, d, p);
                      // A cell takes the active phase when that phase runs that
                      // day and still has budget — or when it's already booked
                      // there, so clicking again takes them off.
                      const takes = !!activeCard && canTake(activeCard, d, p);
                      const dropping = !!dragging && takes && !on;
                      const stretching = inRange(p.key, d);
                      return (
                        <div
                          key={d}
                          style={{ gridColumn: i + 2, gridRow: lastLane }}
                          className={`min-h-[46px] ${weekEdge(d)} ${
                            d === now ? 'bg-brand-green/5' : off ? 'bg-black/[.04]' : ''
                          } ${clash ? 'bg-red-50' : ''} ${
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
                                    taskId: activeCard!.task.id,
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
                                  dropOnDay(activeCard!, p, d);
                                  endDrag();
                                }
                              : undefined
                          }
                          title={
                            takes
                              ? on
                                ? `Take ${p.name} off ${activeCard!.task.name}`
                                : `Book ${p.name} on ${activeCard!.task.project_name} — ${activeCard!.task.name}${
                                    off ? ' (a non-working day — an extra day of work)' : ''
                                  }\nDrag sideways to book a run of days`
                              : undefined
                          }
                        >
                          {takes && !on && items.length === 0 && (
                            <span className="block pt-2.5 text-center text-[10px] font-medium text-brand-green-dark">
                              {dragging ? 'drop' : stretching ? '⇢' : '+ book'}
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {/* One bar per stretch: click it for the job and this
                        person's days, ✕ to take them off the whole stretch. */}
                    {p.bars.map((bar) => {
                      const last = bar.days[bar.days.length - 1];
                      const off = bar.days.some((d) => !isWorkingDay(d, calendar));
                      return (
                        <div
                          key={`${bar.task.id}-${bar.days[0]}`}
                          style={{
                            gridColumn: `${bar.startIdx + 2} / span ${bar.span}`,
                            gridRow: bar.lane + 1,
                            borderLeftColor: jobTint(bar.task.project_id),
                          }}
                          className={`relative z-10 m-0.5 flex min-w-0 items-stretch overflow-hidden rounded border border-l-[3px] border-black/10 ${
                            STATUS_CHIP[bar.task.status]
                          } ${off ? 'ring-1 ring-amber-300' : ''}`}
                        >
                          <button
                            onClick={() =>
                              setOpened({
                                taskId: bar.task.id,
                                person: {
                                  kind: p.kind,
                                  refId: p.refId,
                                  name: p.name,
                                  detail: p.detail,
                                  contracted: false,
                                },
                              })
                            }
                            // Grabbing a booking and pulling sideways is how one
                            // day of a job becomes several — anchored at its last
                            // day, so the drag adds to the end of the stretch.
                            onMouseDown={(e) => {
                              if (e.button !== 0) return;
                              e.preventDefault();
                              setPicked(bar.task.id);
                              setRange({
                                personKey: p.key,
                                taskId: bar.task.id,
                                from: last,
                                to: last,
                              });
                            }}
                            title={`${bar.task.project_name} — ${bar.task.name}\n${
                              bar.days.length === 1
                                ? shortDate(bar.days[0])
                                : `${shortDate(bar.days[0])} – ${shortDate(last)} · ${bar.days.length} days`
                            }${bar.startTime ? `\nStarts ${timeLabel(bar.startTime)}` : ''}\nClick for the job, its start times and ${p.name}'s days — or drag sideways to add days`}
                            className="min-w-0 flex-1 px-1.5 py-1 text-left"
                          >
                            <span className="block truncate text-[11px] font-semibold leading-tight">
                              {bar.task.project_name}
                            </span>
                            <span className="block truncate text-[10px] leading-tight opacity-90">
                              {bar.task.name}
                              {bar.days.length > 1 && ` · ${bar.days.length}d`}
                              {bar.startTime && ` · ${timeLabel(bar.startTime)}`}
                            </span>
                          </button>
                          <button
                            onClick={() => removeBar(bar, p)}
                            title={
                              bar.days.length === 1
                                ? `Take ${p.name} off ${shortDate(bar.days[0])}`
                                : `Take ${p.name} off all ${bar.days.length} days of this stretch`
                            }
                            aria-label={`Remove ${p.name} from ${bar.task.name}`}
                            className="shrink-0 border-l border-black/10 px-1 text-[11px] leading-none text-brand-gray hover:bg-red-100 hover:text-red-700"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Days carrying more people than the phase asked for. Allowed on purpose
          — the budget is a total — but worth seeing before the weeks go out. */}
      <HeavyDays cards={cards} />

      <p className="text-xs text-brand-gray">
        Every phase of every job in view is a card above the grid, in the column of the week it
        starts in. Drag one onto somebody&apos;s day to book that day, or onto their name to put
        them on every working day of it that&apos;s on screen — the card&apos;s crew days count down
        as you go, and you can&apos;t book past what the timeline planned. To put someone on several
        days at once, pick a card (or grab a booking they already have) and drag sideways across
        their row: every day the drag covers gets booked in one pass, and consecutive days show as
        one bar.{' '}
        {weeks > 1 && 'Both weeks take drops from the same card, so a phase running over a weekend is staffed in one pass. '}
        Click a bar for the job&apos;s details, its start times, the notes the crew reads and the
        days that person is on — all editable there — or hit its ✕ to take them off the whole
        stretch. A day shaded red is one where somebody is on two different jobs. Weekends stay off
        the grid until you show them or somebody is booked on one; a weekend or holiday worked is
        ringed amber and adds a day of crew budget to the phase rather than spending the
        weekdays&apos;. Subcontractors aren&apos;t rows here — a sub is engaged on the Job Timeline
        and their days follow the phase — so this grid is our own people only.
      </p>

      {openedCard && (
        <CrewJobCard
          task={openedCard.task}
          window={openedCard.window}
          holidays={holidays}
          publishedVersion={published[openedCard.task.project_id]?.version ?? null}
          person={opened?.person}
          onClose={() => setOpened(null)}
          onSaved={() => {
            setOpened(null);
            refresh();
          }}
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
  // onto anybody, so the card reports who's on it instead.
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
        staffable
          ? `${budget.filled} of ${budget.capacity} crew days booked\nDrag onto a day, or onto a name for the whole phase`
          : `${subName ?? 'A subcontractor'} covers this phase — nothing of ours to book`
      }`}
      className={`min-w-0 grow basis-[148px] rounded-md border border-l-[3px] bg-white p-1.5 text-left transition-shadow ${
        staffable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default border-dashed'
      } ${picked ? 'border-brand-green ring-1 ring-brand-green' : 'border-black/10 hover:shadow-sm'} ${
        dragging ? 'opacity-50' : ''
      } ${staffable && budget.full ? 'bg-brand-green/[.04]' : ''}`}
      style={{ borderLeftColor: picked ? undefined : jobTint(task.project_id) }}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-tight text-brand-ink">
          {task.project_name}
        </p>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          title="Start times &amp; notes"
          aria-label={`Start times and notes for ${task.name}`}
          className="-mt-0.5 shrink-0 rounded px-1 text-[11px] leading-none text-brand-gray hover:bg-black/5 hover:text-brand-ink"
        >
          ⋯
        </button>
      </div>
      <p className="truncate text-[10px] leading-tight text-brand-gray">{task.name}</p>
      {subName && (
        <p className="truncate text-[10px] font-medium leading-tight text-brand-ink">
          Sub: {subName}
        </p>
      )}
      <div className="mt-1 flex items-end justify-between gap-1">
        <div className="min-w-0">
          <p className="truncate text-[10px] leading-tight text-brand-gray">
            {mondayLabel(window.start)} – {mondayLabel(window.end)}
            {task.start_time && ` · ${timeLabel(task.start_time)}`}
          </p>
          <p className="truncate text-[10px] leading-tight text-brand-gray/80">
            {staffable
              ? `${subName ? 'plus ' : ''}${budget.needed}/day · ${budget.days} ${
                  budget.days === 1 ? 'day' : 'days'
                }`
              : `on site all ${budget.days} ${budget.days === 1 ? 'day' : 'days'}`}
          </p>
        </div>
        {staffable && (
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
        <p className="truncate text-[9px] font-medium leading-tight text-amber-700">
          Started {mondayLabel(window.start)}
        </p>
      )}
      {staffable && <BudgetBar filled={budget.filled} capacity={budget.capacity} />}
    </div>
  );
}

/** Monday reads as the start of a week, so its column carries a heavier rule. */
function weekEdge(day: string): string {
  return fromDay(day).getDay() === 1 ? 'border-l border-black/20' : 'border-l border-black/5';
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

const STATUS_CHIP: Record<ScheduleTaskRow['status'], string> = {
  not_started: 'bg-brand-gray/15 text-brand-ink',
  in_progress: 'bg-status-progress/20 text-brand-ink',
  complete: 'bg-brand-green/20 text-brand-green-dark',
};
