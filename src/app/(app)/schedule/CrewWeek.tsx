'use client';

import { useMemo, useState, useTransition, type DragEvent } from 'react';
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
  type WeekBand,
} from '@/lib/schedule-math';
import type { ScheduleTaskRow } from '@/lib/types';
import {
  assignCrewDayAction,
  assignCrewSpanAction,
  unassignCrewDayAction,
} from '@/app/actions/schedule';
import { CrewJobCard } from './CrewJobCard';
import type { SubOption, WorkerOption } from './TaskModal';
import type { PublishedInfo } from './PublishBar';

/**
 * One phase a person is on for one day. `contracted` days come from the phase
 * being subcontracted rather than from a crew-day booking, and are read-only.
 */
type DayEntry = { task: ScheduleTaskRow; startTime: string | null; contracted: boolean };

/** Widths the crew grid opens at, in whole weeks — two by default. */
const SPANS = [
  { weeks: 1, label: 'Week' },
  { weeks: 2, label: '2 Weeks' },
] as const;

const DEFAULT_WEEKS = 2;

/** What a card being dragged carries. Read on drop; the state drives the hover. */
const DRAG_TYPE = 'application/x-cornerstone-phase';

/** A phase card, as both the rail and the grid need it. */
interface PhaseCard {
  task: ScheduleTaskRow;
  window: ComputedWindow;
  budget: ReturnType<typeof crewBudget>;
  byDay: Map<string, { kind: 'user' | 'sub'; ref_id: number }[]>;
  /** The phase's working days that are on screen — what a card can be dropped on. */
  days: string[];
}

interface Person {
  key: string;
  kind: 'user' | 'sub';
  refId: number;
  name: string;
  detail: string;
  internal: boolean;
}

/**
 * The weeks the crew is actually staffed in — a fortnight at a time, with the
 * work to be staffed sitting beside it as cards.
 *
 * Every phase of every job with work on screen gets its own small card in the
 * rail: two phases of the same job are two cards, because they're two different
 * asks with two different budgets. Drag a card onto somebody's day to book them
 * for that day, or onto their name to put them on every day of it that's on
 * screen. Clicking a card still picks it for click-to-book, which is what
 * touchscreens and keyboards get.
 *
 * A subcontracted phase is read-only here. The sub was engaged on the timeline,
 * so they're on site every working day of it and their days follow its dates —
 * there's no budget to spend, so its card can't be dragged or picked. Only the
 * crew we send alongside them, if any, is booked here.
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
  subs,
  holidays,
  published = {},
}: {
  tasks: ScheduleTaskRow[];
  workers: WorkerOption[];
  subs: SubOption[];
  holidays: string[];
  /** Publish state per job id, so a card can say a change needs a reason. */
  published?: Record<number, PublishedInfo>;
}) {
  const router = useRouter();
  /** How many weeks are on screen — the nav steps by exactly this much. */
  const [weeks, setWeeks] = useState<number>(DEFAULT_WEEKS);
  const [anchor, setAnchor] = useState<string>(() => weekStart(today()));
  const [showIdle, setShowIdle] = useState(true);
  const [includeSubs, setIncludeSubs] = useState(false);
  /** Narrows the rail to phases still missing crew. */
  const [onlyShort, setOnlyShort] = useState(false);
  /** Free-text filter over the rail — job, phase or customer. */
  const [search, setSearch] = useState('');
  /** The phase picked by click, for booking without a mouse drag. */
  const [picked, setPicked] = useState<number | null>(null);
  /** The phase currently being dragged. */
  const [dragging, setDragging] = useState<number | null>(null);
  /** The cell or name the drag is over: `person|day`, or `person|row`. */
  const [over, setOver] = useState<string | null>(null);
  /** The phase whose card is open. */
  const [opened, setOpened] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const calendar = useMemo(() => ({ holidays: new Set(holidays) }), [holidays]);
  const now = today();

  const { windows } = useMemo(() => computeSchedule(tasks, calendar), [tasks, calendar]);

  // Always a whole number of weeks starting on a Monday: the crew reads the
  // schedule a week at a time, and a fortnight that opened mid-week would put
  // the same weekday in a different column every time it was paged.
  const range = useMemo(() => weekAlignedRange(anchor, weeks * 7), [anchor, weeks]);
  const rangeDays = useMemo(() => eachDay(range.start, range.end), [range]);
  const rangeFrom = range.start;
  const rangeTo = range.end;

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
  const openedCard = opened != null ? cardByTask.get(opened) : undefined;

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
        if (!list.some((e) => e.task.id === entry.task.id)) list.push(entry);
      } else days.set(day, [entry]);
    };

    for (const card of cards) {
      const { task } = card;
      const times = dayTimeMap(task.day_times ?? []);
      if (task.subcontractor_id != null) {
        for (const day of card.days) {
          add(`sub:${task.subcontractor_id}`, day, {
            task,
            startTime: startTimeOn(day, task.start_time, times),
            contracted: true,
          });
        }
      }
      for (const c of task.crew_days ?? []) {
        if (c.day < rangeFrom || c.day > rangeTo) continue;
        add(`${c.kind}:${c.ref_id}`, c.day, {
          task,
          startTime: startTimeOn(c.day, task.start_time, times),
          contracted: false,
        });
      }
    }
    return out;
  }, [cards, rangeFrom, rangeTo]);

  // A weekend column only appears when that particular Saturday or Sunday has
  // work on it, so a normal fortnight stays ten columns wide and nobody reads a
  // weekend into the plan — while a weekend the crew really is working still
  // shows, in the week it belongs to.
  const columns = useMemo(
    () =>
      rangeDays.filter((d) => {
        if (!isWeekend(d)) return true;
        if ([...byPerson.values()].some((days) => (days.get(d)?.length ?? 0) > 0)) return true;
        return activeCard?.days.includes(d) ?? false;
      }),
    [rangeDays, byPerson, activeCard]
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
        internal: true,
      })),
      ...(includeSubs
        ? subs.map((s) => ({
            key: `sub:${s.id}`,
            kind: 'sub' as const,
            refId: s.id,
            name: s.name,
            detail: s.trade ?? 'Subcontractor',
            internal: false,
          }))
        : []),
    ];
    return rows
      .map((p) => {
        const days = byPerson.get(p.key) ?? new Map<string, DayEntry[]>();
        const booked = columns.filter((d) => (days.get(d)?.length ?? 0) > 0);
        // Two different jobs on one day is a real double-booking; two phases of
        // the same job is just one crew doing two things there.
        const clashes = columns.filter(
          (d) => new Set((days.get(d) ?? []).map((b) => b.task.project_id)).size > 1
        );
        return { ...p, days, bookedCount: booked.length, clashes };
      })
      .filter((p) => showIdle || p.bookedCount > 0)
      .sort((a, b) =>
        a.internal === b.internal ? a.name.localeCompare(b.name) : a.internal ? -1 : 1
      );
  }, [workers, subs, includeSubs, byPerson, columns, showIdle]);

  // Day columns share whatever width is left rather than claiming a fixed one,
  // so a whole fortnight fits beside the rail instead of scrolling out of sight.
  // Chips truncate and carry the full job on hover; the Week view is where a
  // narrow screen goes for detail.
  const gridTemplate = `minmax(112px, 150px) repeat(${columns.length}, minmax(0, 1fr))`;
  const gridMinWidth = columns.length > 7 ? 880 : 660;
  const bookedPeople = people.filter((p) => p.bookedCount > 0).length;
  const understaffed = cards.filter((c) => c.budget.remaining > 0).length;
  const needle = search.trim().toLowerCase();
  const railCards = cards
    .filter((c) => !onlyShort || c.budget.remaining > 0)
    .filter(
      (c) =>
        needle === '' ||
        `${c.task.project_name} ${c.task.name} ${c.task.customer}`.toLowerCase().includes(needle)
    );
  const heading = weeks === 1 ? weekLabel(rangeFrom) : rangeLabel(rangeFrom, rangeTo);

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
   * A day this phase can take crew on — on the phase, not already full, and not
   * the sub who holds the phase: their days come with the contract, so there's
   * nothing here to give or take.
   */
  function canTake(card: PhaseCard, day: string, person: Person): boolean {
    if (!isStaffable(card)) return false;
    if (person.kind === 'sub' && card.task.subcontractor_id === person.refId) return false;
    return card.days.includes(day) && (isBooked(card, day, person) || !card.budget.full);
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

  /**
   * A card dropped on somebody's name puts them on the whole phase — every day
   * of it that's on screen, as far as the budget goes.
   */
  function dropOnPerson(card: PhaseCard, person: Person) {
    setError(null);
    const days = card.days.filter((d) => !isBooked(card, d, person));
    if (days.length === 0) {
      setError(`${person.name} is already on every day of ${card.task.name} in view.`);
      return;
    }
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

  async function removeFrom(taskId: number, day: string, person: Person) {
    setError(null);
    startTransition(async () => {
      const res = await unassignCrewDayAction({
        task_id: taskId,
        day,
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

  return (
    <div className="space-y-3">
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

        <p className="text-sm font-semibold text-brand-ink">
          {heading}
          <span className="ml-2 font-normal text-brand-gray">
            {bookedPeople === 0
              ? 'nobody booked'
              : `${bookedPeople} ${bookedPeople === 1 ? 'person' : 'people'} booked`}
            {understaffed > 0 &&
              ` · ${understaffed} ${understaffed === 1 ? 'phase still needs' : 'phases still need'} crew`}
          </span>
        </p>

        <label className="ml-auto flex items-center gap-2 text-sm text-brand-ink">
          <input
            type="checkbox"
            checked={showIdle}
            onChange={(e) => setShowIdle(e.target.checked)}
          />
          Show everyone
        </label>
        <label className="flex items-center gap-2 text-sm text-brand-ink">
          <input
            type="checkbox"
            checked={includeSubs}
            onChange={(e) => setIncludeSubs(e.target.checked)}
          />
          Include subs
        </label>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        {/* The work to be staffed: one small card per job phase, dragged onto the
            grid. Kept narrow and dense so a fortnight of work fits beside it. */}
        <aside className="card w-full shrink-0 p-2 lg:sticky lg:top-2 lg:w-[268px]">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
              Work to staff
            </p>
            <span className="text-xs font-semibold text-brand-ink">{railCards.length}</span>
          </div>
          <input
            className="input mt-1.5 h-8 py-1 text-xs"
            placeholder="Search job, phase, customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-brand-ink">
            <input
              type="checkbox"
              checked={onlyShort}
              onChange={(e) => setOnlyShort(e.target.checked)}
            />
            Only phases still needing crew
          </label>

          {cards.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-brand-gray">
              Nothing runs in these weeks. Plan work on the Job Timeline and its card appears here.
            </p>
          ) : railCards.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-brand-gray">
              No phase matches. Clear the search, or untick the filter.
            </p>
          ) : (
            <div className="mt-2 max-h-[62vh] space-y-1.5 overflow-y-auto pr-0.5">
              {railCards.map((c) => (
                <PhaseTile
                  key={c.task.id}
                  card={c}
                  picked={picked === c.task.id}
                  dragging={dragging === c.task.id}
                  bands={bands}
                  columns={columns}
                  onPick={() => setPicked(picked === c.task.id ? null : c.task.id)}
                  onOpen={() => setOpened(c.task.id)}
                  onDragStart={(e) => startDrag(e, c)}
                  onDragEnd={endDrag}
                />
              ))}
            </div>
          )}
          <p className="mt-2 border-t border-black/5 px-1 pt-1.5 text-[10px] leading-snug text-brand-gray">
            Drag a card onto a day to book it, or onto a name for every day of it on screen. No
            mouse? Tap a card, then tap the day cells.
          </p>
        </aside>

        {people.length === 0 ? (
          <div className="card flex-1 p-10 text-center">
            <p className="font-semibold text-brand-ink">Nobody to show</p>
            <p className="mt-1 text-sm text-brand-gray">
              Nobody is booked for {heading}. Tick &ldquo;Show everyone&rdquo; to see the whole crew.
            </p>
          </div>
        ) : (
          <div className={`card min-w-0 flex-1 overflow-hidden ${pending ? 'opacity-70' : ''}`}>
            <div className="overflow-x-auto">
              <div style={{ minWidth: `${gridMinWidth}px` }}>
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
                    return (
                      <div
                        key={d}
                        className={`px-2 py-1.5 text-[11px] font-semibold ${weekEdge(d)} ${
                          d === now
                            ? 'text-brand-green-dark'
                            : off
                              ? 'text-brand-gray/60'
                              : 'text-brand-gray'
                        }`}
                      >
                        {DAY_LABELS[fromDay(d).getDay()]} {fromDay(d).getDate()}
                        {off && <span className="ml-1 font-normal">(off)</span>}
                      </div>
                    );
                  })}
                </div>

                {people.map((p) => {
                  const rowKey = `${p.key}|row`;
                  // Dropping on a name means "put them on this phase" — only
                  // offered while a phase with room is actually being dragged.
                  const rowTakes =
                    !!activeCard &&
                    !!dragging &&
                    activeCard.days.some((d) => canTake(activeCard, d, p));
                  return (
                    <div
                      key={p.key}
                      className="grid border-b border-black/5 last:border-0"
                      style={{ gridTemplateColumns: gridTemplate }}
                    >
                      <div
                        className={`sticky left-0 z-20 bg-white px-3 py-1.5 ${
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
                            ? `Put ${p.name} on ${activeCard!.task.name} for every day of it on screen`
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
                          {p.internal ? p.detail : `${p.detail} · sub`}
                          {p.clashes.length > 0 && (
                            <span className="text-red-700"> · double-booked</span>
                          )}
                        </p>
                      </div>

                      {columns.map((d) => {
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
                        // The sub carrying a phase is on it by contract, not by
                        // booking — there's no day here to give or take.
                        const contractedHere =
                          !!activeCard &&
                          p.kind === 'sub' &&
                          activeCard.task.subcontractor_id === p.refId;
                        return (
                          <div
                            key={d}
                            className={`min-h-[42px] space-y-0.5 p-1 ${weekEdge(d)} ${
                              d === now ? 'bg-brand-green/5' : off ? 'bg-black/[.04]' : ''
                            } ${clash ? 'bg-red-50' : ''} ${
                              takes && !dragging
                                ? 'cursor-pointer ring-1 ring-inset ring-brand-green/40 hover:bg-brand-green/10'
                                : ''
                            } ${dropping ? 'cursor-copy ring-1 ring-inset ring-brand-green/60' : ''} ${
                              over === cellKey && dropping ? 'bg-brand-green/20' : ''
                            }`}
                            onClick={takes && !dragging ? () => toggleCell(p, d) : undefined}
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
                              contractedHere
                                ? `${p.name} has this phase — their days follow it, change it on the timeline`
                                : takes
                                  ? on
                                    ? `Take ${p.name} off ${activeCard!.task.name}`
                                    : `Book ${p.name} on ${activeCard!.task.project_name} — ${activeCard!.task.name}`
                                  : undefined
                            }
                          >
                            {items.map((b) => (
                              <button
                                key={b.task.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!b.contracted) removeFrom(b.task.id, d, p);
                                }}
                                disabled={b.contracted}
                                title={`${b.task.project_name} — ${b.task.name}${
                                  b.startTime ? `\nStarts ${timeLabel(b.startTime)}` : ''
                                }\n${
                                  b.contracted
                                    ? 'Subcontracted for this phase — their days follow its dates'
                                    : `Click to take ${p.name} off this day`
                                }`}
                                className={`block w-full rounded border-l-[3px] px-1 py-0.5 text-left text-[10px] leading-tight ${
                                  b.contracted ? CONTRACTED_CHIP : STATUS_CHIP[b.task.status]
                                }`}
                                style={{ borderLeftColor: jobTint(b.task.project_id) }}
                              >
                                {/* Three short lines rather than two crowded
                                    ones: at a fortnight's column width, a start
                                    time sharing a line with the job or the phase
                                    truncates the other one away entirely. */}
                                {b.startTime && (
                                  <span className="block truncate text-[9px] font-bold leading-tight text-brand-green-dark">
                                    {timeLabel(b.startTime)}
                                  </span>
                                )}
                                <span className="block truncate font-semibold">
                                  {b.task.project_name}
                                </span>
                                <span className="block truncate opacity-90">{b.task.name}</span>
                              </button>
                            ))}
                            {takes && !on && items.length === 0 && (
                              <span className="block pt-1 text-center text-[10px] font-medium text-brand-green-dark">
                                {dragging ? 'drop' : '+ book'}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Days carrying more people than the phase asked for. Allowed on purpose
          — the budget is a total — but worth seeing before the weeks go out. */}
      <HeavyDays cards={cards} />

      <p className="text-xs text-brand-gray">
        Every phase of every job in view is a card in the rail. Drag one onto somebody&apos;s day to
        book that day, or onto their name to put them on every day of it that&apos;s on screen — the
        card&apos;s crew days count down as you go, and you can&apos;t book past what the timeline
        planned.{' '}
        {weeks > 1 && 'Both weeks take drops from the same card, so a phase running over a weekend is staffed in one pass. '}
        Click a booking to take someone off that day. A day shaded red is one where somebody is on
        two different jobs. A subcontracted phase shows its sub on every day it runs, dashed and not
        clickable — they were engaged on the timeline, so their days follow its dates and its card
        can&apos;t be dragged. Open a card&apos;s ⋯ to set start times day by day and write what the
        crew needs to know.
      </p>

      {openedCard && (
        <CrewJobCard
          task={openedCard.task}
          window={openedCard.window}
          holidays={holidays}
          publishedVersion={published[openedCard.task.project_id]?.version ?? null}
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
 * One job phase as a card small enough that a fortnight's worth of them sit
 * beside the grid: the job, the phase, when it runs, and — in the size that
 * matters most — how many crew days are still to fill.
 */
function PhaseTile({
  card,
  picked,
  dragging,
  bands,
  columns,
  onPick,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  card: PhaseCard;
  picked: boolean;
  dragging: boolean;
  bands: WeekBand[];
  columns: string[];
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
      className={`rounded-md border border-l-[3px] bg-white p-1.5 text-left transition-shadow ${
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
      {staffable && <BudgetBar filled={budget.filled} capacity={budget.capacity} />}
      {bands.length > 1 && (
        <WeekSplit card={card} bands={bands} columns={columns} staffable={staffable} />
      )}
    </div>
  );
}

/** Monday reads as the start of a week, so its column carries a heavier rule. */
function weekEdge(day: string): string {
  return fromDay(day).getDay() === 1 ? 'border-l border-black/20' : 'border-l border-black/5';
}

/**
 * A phase's work split across the weeks on screen: days it runs in each week,
 * and crew booked there. On a fortnight this is the difference between a phase
 * that's short two people this week and one that's short them next week.
 */
function WeekSplit({
  card,
  bands,
  columns,
  staffable = true,
}: {
  card: { byDay: Map<string, unknown[]>; days: string[] };
  bands: WeekBand[];
  columns: string[];
  /** False on a subcontracted phase needing none of our crew — nothing to book. */
  staffable?: boolean;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {bands.map((b) => {
        const weekDays = columns.slice(b.startIdx, b.startIdx + b.span);
        const runs = weekDays.filter((d) => card.days.includes(d)).length;
        const booked = weekDays.reduce((n, d) => n + (card.byDay.get(d)?.length ?? 0), 0);
        return (
          <span
            key={b.monday}
            className={`rounded px-1 py-0.5 text-[9px] font-medium ${
              runs === 0 ? 'bg-black/[.04] text-brand-gray/70' : 'bg-black/[.05] text-brand-gray'
            }`}
            title={`Week of ${shortDate(b.monday)}`}
          >
            {mondayLabel(b.monday)}:{' '}
            {runs === 0 ? 'none' : staffable ? `${runs}d · ${booked} booked` : `${runs}d on site`}
          </span>
        );
      })}
    </div>
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

/** A sub's day that comes from holding the phase, not from being booked on it. */
const CONTRACTED_CHIP =
  'cursor-default border border-dashed border-brand-gray/40 bg-brand-gray/5 text-brand-ink';

const STATUS_CHIP: Record<ScheduleTaskRow['status'], string> = {
  not_started: 'bg-brand-gray/15 text-brand-ink hover:bg-red-100 hover:text-red-700',
  in_progress: 'bg-status-progress/20 text-brand-ink hover:bg-red-100 hover:text-red-700',
  complete: 'bg-brand-green/20 text-brand-green-dark hover:bg-red-100 hover:text-red-700',
};
