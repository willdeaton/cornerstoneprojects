'use client';

import { useMemo, useState, useTransition } from 'react';
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
import { assignCrewDayAction, unassignCrewDayAction } from '@/app/actions/schedule';
import { CrewJobCard } from './CrewJobCard';
import type { SubOption, WorkerOption } from './TaskModal';
import type { PublishedInfo } from './PublishBar';

/** Widths the crew grid opens at, in whole weeks — two by default. */
const SPANS = [
  { weeks: 1, label: 'Week' },
  { weeks: 2, label: '2 Weeks' },
] as const;

const DEFAULT_WEEKS = 2;

/**
 * The weeks the crew is actually staffed in — a fortnight at a time.
 *
 * The timeline says a phase needs three people for four days. This is where
 * those twelve crew-days get spent: pick a job card, then click the day cells of
 * the people who'll work it. The budget is a total rather than a per-day quota,
 * so four people Monday and one Friday is a legitimate way to cover a 2-crew,
 * 5-day phase — which is how a week usually falls. A day carrying more than the
 * phase asked for is flagged, never blocked.
 *
 * Two weeks show side by side so work that runs over a weekend, or a job whose
 * next phase starts the following Monday, can be staffed without paging. Every
 * job and phase with work in view gets its own card — two phases of the same job
 * are two cards, because they're two different asks with two different budgets.
 * Clicking a card opens it: start times day by day, and the notes the crew reads
 * before they turn up.
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
  /** Narrows the card list to phases still missing crew. */
  const [onlyShort, setOnlyShort] = useState(false);
  /** The phase being staffed — clicking a day cell books it. */
  const [picked, setPicked] = useState<number | null>(null);
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
  const cards = useMemo(() => {
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
        // The days of this phase that fall in the range on screen.
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
  const pickedCard = picked != null ? cardByTask.get(picked) : undefined;
  const openedCard = opened != null ? cardByTask.get(opened) : undefined;

  /** Person -> day -> the phases they're booked on that day, in view. */
  const byPerson = useMemo(() => {
    const out = new Map<string, Map<string, { task: ScheduleTaskRow; startTime: string | null }[]>>();
    for (const { task } of cards) {
      const times = dayTimeMap(task.day_times ?? []);
      for (const c of task.crew_days ?? []) {
        if (c.day < rangeFrom || c.day > rangeTo) continue;
        const key = `${c.kind}:${c.ref_id}`;
        let days = out.get(key);
        if (!days) {
          days = new Map();
          out.set(key, days);
        }
        const entry = { task, startTime: startTimeOn(c.day, task.start_time, times) };
        const list = days.get(c.day);
        if (list) list.push(entry);
        else days.set(c.day, [entry]);
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
        return pickedCard?.days.includes(d) ?? false;
      }),
    [rangeDays, byPerson, pickedCard]
  );

  /** One band per week over the columns, so each week is labelled above its days. */
  const bands = useMemo(() => weekBands(columns), [columns]);

  const people = useMemo(() => {
    const rows = [
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
        const days = byPerson.get(p.key) ?? new Map<string, { task: ScheduleTaskRow; startTime: string | null }[]>();
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

  // Ten or fourteen columns need to be narrower than seven, but never so narrow
  // that a job and phase can't be read off a chip — so the grid scrolls instead.
  const dayWidth = columns.length > 7 ? 116 : 130;
  const gridTemplate = `minmax(150px, 200px) repeat(${columns.length}, minmax(${dayWidth}px, 1fr))`;
  const gridMinWidth = 200 + columns.length * dayWidth;
  const bookedPeople = people.filter((p) => p.bookedCount > 0).length;
  const visibleCards = onlyShort ? cards.filter((c) => c.budget.remaining > 0) : cards;
  const understaffed = cards.filter((c) => c.budget.remaining > 0).length;
  const heading = weeks === 1 ? weekLabel(rangeFrom) : rangeLabel(rangeFrom, rangeTo);

  function refresh() {
    startTransition(() => router.refresh());
  }

  /** Book the picked phase onto one person's day, or take them back off it. */
  function toggleCell(person: { kind: 'user' | 'sub'; refId: number }, day: string) {
    if (!pickedCard) return;
    setError(null);
    const already = (pickedCard.byDay.get(day) ?? []).some(
      (c) => c.kind === person.kind && c.ref_id === person.refId
    );
    startTransition(async () => {
      const args = { task_id: pickedCard.task.id, day, kind: person.kind, ref_id: person.refId };
      const res = already ? await unassignCrewDayAction(args) : await assignCrewDayAction(args);
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Could not change that booking.');
    });
  }

  async function removeFrom(
    taskId: number,
    day: string,
    person: { kind: 'user' | 'sub'; refId: number }
  ) {
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

  return (
    <div className="space-y-4">
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
                  ? 'bg-brand-green text-white'
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

      {/* Job cards: one per job and phase with work in view, and the budget left
          on each. Two phases of the same job are two cards on purpose. */}
      {cards.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="font-semibold text-brand-ink">No jobs run in these weeks</p>
          <p className="mt-1 text-sm text-brand-gray">
            Plan work on the Job Timeline — how long it runs and how many people it needs — and its
            card will appear here to staff.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
              {visibleCards.length} {visibleCards.length === 1 ? 'job phase' : 'job phases'} in view
            </p>
            {understaffed > 0 && (
              <label className="flex items-center gap-2 text-xs text-brand-ink">
                <input
                  type="checkbox"
                  checked={onlyShort}
                  onChange={(e) => setOnlyShort(e.target.checked)}
                />
                Only phases still needing crew
              </label>
            )}
          </div>

          {visibleCards.length === 0 ? (
            <div className="card p-4 text-center text-sm text-brand-gray">
              Every phase in view is fully staffed.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleCards.map((c) => {
                const active = picked === c.task.id;
                return (
                  <div
                    key={c.task.id}
                    className={`card p-3 transition-shadow ${
                      active ? 'ring-2 ring-brand-green' : 'hover:shadow-md'
                    }`}
                  >
                    <button
                      onClick={() => setPicked(active ? null : c.task.id)}
                      className="block w-full text-left"
                      aria-pressed={active}
                      title={active ? 'Stop booking this phase' : 'Book crew onto this phase'}
                    >
                      <p className="truncate text-sm font-semibold text-brand-ink">
                        {c.task.project_name}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5">
                        <span className="max-w-full truncate rounded bg-brand-ink/[.06] px-1.5 py-0.5 text-[11px] font-semibold text-brand-ink">
                          {c.task.name}
                        </span>
                      </p>
                      <p className="mt-1 truncate text-xs text-brand-gray">{c.task.customer}</p>
                      <p className="mt-1 text-xs text-brand-gray">
                        {shortDate(c.window.start)} – {shortDate(c.window.end)}
                        {c.task.start_time && ` · starts ${timeLabel(c.task.start_time)}`}
                      </p>
                      <BudgetBar filled={c.budget.filled} capacity={c.budget.capacity} />
                      <p
                        className={`mt-1 text-xs font-medium ${
                          c.budget.remaining === 0 ? 'text-brand-green-dark' : 'text-amber-700'
                        }`}
                      >
                        {c.budget.filled} / {c.budget.capacity} crew days
                        {c.budget.remaining === 0
                          ? ' · fully staffed'
                          : ` · ${c.budget.remaining} to fill`}
                      </p>
                      <p className="text-[11px] text-brand-gray">
                        needs {c.budget.needed} {c.budget.needed === 1 ? 'person' : 'people'} a day ·{' '}
                        {c.budget.days} working {c.budget.days === 1 ? 'day' : 'days'}
                      </p>
                      {bands.length > 1 && <WeekSplit card={c} bands={bands} columns={columns} />}
                    </button>
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-black/5 pt-2">
                      <span
                        className={`text-[11px] font-medium ${
                          c.budget.full ? 'text-brand-gray' : 'text-brand-green-dark'
                        }`}
                      >
                        {!active
                          ? ''
                          : c.budget.full
                            ? 'Fully staffed — click a booking to free a day'
                            : 'Click a day cell below to book'}
                      </span>
                      <button
                        className="text-xs font-medium text-brand-green-dark hover:underline"
                        onClick={() => setOpened(c.task.id)}
                      >
                        Start times &amp; notes
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {people.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-semibold text-brand-ink">Nobody to show</p>
          <p className="mt-1 text-sm text-brand-gray">
            Nobody is booked for {heading}. Tick &ldquo;Show everyone&rdquo; to see the whole crew.
          </p>
        </div>
      ) : (
        <div className={`card overflow-hidden ${pending ? 'opacity-70' : ''}`}>
          <div className="overflow-x-auto">
            <div style={{ minWidth: `${gridMinWidth}px` }}>
              {/* Week band: each week's Monday, held across that week's columns. */}
              <div
                className="grid border-b border-black/10 bg-black/[.04]"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                <div className="sticky left-0 z-20 bg-[#f4f4f4] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-brand-gray">
                  Crew
                </div>
                {bands.map((b) => (
                  <div
                    key={b.monday}
                    style={{ gridColumn: `${b.startIdx + 2} / ${b.startIdx + b.span + 2}` }}
                    className={`border-l border-black/10 px-2 py-1.5 text-xs font-semibold ${
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
                <div className="sticky left-0 z-20 bg-[#fafafa] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">
                  Employee
                </div>
                {columns.map((d) => {
                  const off = !isWorkingDay(d, calendar);
                  return (
                    <div
                      key={d}
                      className={`px-2 py-2 text-xs font-semibold ${weekEdge(d)} ${
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

              {people.map((p) => (
                <div
                  key={p.key}
                  className="grid border-b border-black/5 last:border-0"
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  <div className="sticky left-0 z-20 bg-white px-4 py-2">
                    <p className="truncate text-sm font-medium text-brand-ink">
                      {p.name}
                      {!p.internal && <span className="text-brand-gray"> · sub</span>}
                    </p>
                    <p className="truncate text-xs text-brand-gray">{p.detail}</p>
                    <p
                      className={`text-xs font-medium ${
                        p.clashes.length > 0
                          ? 'text-red-700'
                          : p.bookedCount === 0
                            ? 'text-brand-gray/70'
                            : 'text-brand-gray'
                      }`}
                    >
                      {p.bookedCount === 0
                        ? 'Not booked'
                        : `${p.bookedCount} ${p.bookedCount === 1 ? 'day' : 'days'}`}
                      {p.clashes.length > 0 && ' · double-booked'}
                    </p>
                  </div>

                  {columns.map((d) => {
                    const items = p.days.get(d) ?? [];
                    const off = !isWorkingDay(d, calendar);
                    const clash = new Set(items.map((b) => b.task.project_id)).size > 1;
                    // A cell can take the picked phase when that phase runs that
                    // day and still has budget — or when it's already booked
                    // there, so clicking again takes them off.
                    const on =
                      !!pickedCard &&
                      (pickedCard.byDay.get(d) ?? []).some(
                        (c) => c.kind === p.kind && c.ref_id === p.refId
                      );
                    const bookable =
                      !!pickedCard && (pickedCard.days.includes(d) ?? false) && (on || !pickedCard.budget.full);
                    return (
                      <div
                        key={d}
                        className={`min-h-[64px] space-y-1 p-1.5 ${weekEdge(d)} ${
                          d === now ? 'bg-brand-green/5' : off ? 'bg-black/[.04]' : ''
                        } ${clash ? 'bg-red-50' : ''} ${
                          bookable ? 'cursor-pointer ring-1 ring-inset ring-brand-green/40 hover:bg-brand-green/10' : ''
                        }`}
                        onClick={bookable ? () => toggleCell(p, d) : undefined}
                        title={
                          bookable
                            ? on
                              ? `Take ${p.name} off ${pickedCard!.task.project_name} — ${pickedCard!.task.name}`
                              : `Book ${p.name} on ${pickedCard!.task.project_name} — ${pickedCard!.task.name}`
                            : undefined
                        }
                      >
                        {items.map((b) => (
                          <button
                            key={b.task.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFrom(b.task.id, d, p);
                            }}
                            title={`${b.task.project_name} — ${b.task.name}${
                              b.startTime ? `\nStarts ${timeLabel(b.startTime)}` : ''
                            }\nClick to take ${p.name} off this day`}
                            className={`block w-full rounded px-1.5 py-1 text-left text-[11px] leading-tight ${
                              STATUS_CHIP[b.task.status]
                            }`}
                          >
                            {b.startTime && (
                              <span className="block truncate font-bold">
                                {timeLabel(b.startTime)}
                              </span>
                            )}
                            <span className="block truncate font-semibold">
                              {b.task.project_name}
                            </span>
                            <span className="block truncate opacity-90">{b.task.name}</span>
                          </button>
                        ))}
                        {bookable && !on && items.length === 0 && (
                          <span className="block text-center text-[11px] font-medium text-brand-green-dark">
                            + book
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Days carrying more people than the phase asked for. Allowed on purpose
          — the budget is a total — but worth seeing before the weeks go out. */}
      <HeavyDays cards={cards} />

      <p className="text-xs text-brand-gray">
        Pick a job card — one per job and phase — then click the day cells of the people working it.
        The card&apos;s crew days count down as you go, and you can&apos;t book past what the
        timeline planned.{' '}
        {weeks > 1 &&
          'Both weeks book from the same card, so a phase running over a weekend is staffed in one pass. '}
        Click a booking to take someone off that day. A day shaded red is one where somebody is on
        two different jobs. Open a card to set start times day by day and write what the crew needs
        to know.
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
}: {
  card: { window: ComputedWindow; byDay: Map<string, unknown[]>; days: string[] };
  bands: WeekBand[];
  columns: string[];
}) {
  return (
    <span className="mt-1.5 flex flex-wrap gap-1">
      {bands.map((b) => {
        const weekDays = columns.slice(b.startIdx, b.startIdx + b.span);
        const runs = weekDays.filter((d) => card.days.includes(d)).length;
        const booked = weekDays.reduce((n, d) => n + (card.byDay.get(d)?.length ?? 0), 0);
        return (
          <span
            key={b.monday}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              runs === 0 ? 'bg-black/[.04] text-brand-gray/70' : 'bg-black/[.05] text-brand-gray'
            }`}
            title={`Week of ${shortDate(b.monday)}`}
          >
            {mondayLabel(b.monday)}:{' '}
            {runs === 0 ? 'no work' : `${runs} ${runs === 1 ? 'day' : 'days'} · ${booked} booked`}
          </span>
        );
      })}
    </span>
  );
}

/** How much of a phase's crew budget is spent, as a bar. */
function BudgetBar({ filled, capacity }: { filled: number; capacity: number }) {
  const pct = capacity === 0 ? 0 : Math.min(100, (filled / capacity) * 100);
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
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

const STATUS_CHIP: Record<ScheduleTaskRow['status'], string> = {
  not_started: 'bg-brand-gray/15 text-brand-ink hover:bg-red-100 hover:text-red-700',
  in_progress: 'bg-status-progress/20 text-brand-ink hover:bg-red-100 hover:text-red-700',
  complete: 'bg-brand-green/20 text-brand-green-dark hover:bg-red-100 hover:text-red-700',
};
