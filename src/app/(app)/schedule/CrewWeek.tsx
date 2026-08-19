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
  isWorkingDay,
  startTimeOn,
  timeLabel,
  today,
  weekLabel,
  weekStart,
  dayTimeMap,
  type ComputedWindow,
} from '@/lib/schedule-math';
import type { ScheduleTaskRow } from '@/lib/types';
import { assignCrewDayAction, unassignCrewDayAction } from '@/app/actions/schedule';
import { CrewJobCard } from './CrewJobCard';
import type { SubOption, WorkerOption } from './TaskModal';
import type { PublishedInfo } from './PublishBar';

/**
 * The week the crew is actually staffed in.
 *
 * The timeline says a phase needs three people for four days. This is where
 * those twelve crew-days get spent: pick a job card, then click the day cells of
 * the people who'll work it. The budget is a total rather than a per-day quota,
 * so four people Monday and one Friday is a legitimate way to cover a 2-crew,
 * 5-day phase — which is how a week usually falls. A day carrying more than the
 * phase asked for is flagged, never blocked.
 *
 * Clicking a job card opens it: start times day by day, and the notes the crew
 * reads before they turn up.
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
  const [monday, setMonday] = useState<string>(() => weekStart(today()));
  const [showIdle, setShowIdle] = useState(true);
  const [includeSubs, setIncludeSubs] = useState(false);
  /** The phase being staffed — clicking a day cell books it. */
  const [picked, setPicked] = useState<number | null>(null);
  /** The phase whose card is open. */
  const [opened, setOpened] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const calendar = useMemo(() => ({ holidays: new Set(holidays) }), [holidays]);
  const now = today();

  const { windows } = useMemo(() => computeSchedule(tasks, calendar), [tasks, calendar]);

  const weekDays = useMemo(() => eachDay(monday, addDays(monday, 6)), [monday]);
  const weekFrom = weekDays[0];
  const weekTo = weekDays[6];

  /** The phases with work in this week — one card each, in date order. */
  const cards = useMemo(() => {
    return tasks
      .map((task) => ({ task, window: windows.get(task.id) }))
      .filter(
        (c): c is { task: ScheduleTaskRow; window: ComputedWindow } =>
          !!c.window && c.window.start <= weekTo && c.window.end >= weekFrom
      )
      .map(({ task, window }) => ({
        task,
        window,
        budget: crewBudget(task, window, calendar),
        byDay: crewByDay(task),
        // The days of this phase that fall in the week on screen.
        days: weekDays.filter(
          (d) => d >= window.start && d <= window.end && isWorkingDay(d, calendar)
        ),
      }))
      .sort((a, b) =>
        a.window.start === b.window.start
          ? a.task.project_name.localeCompare(b.task.project_name)
          : a.window.start < b.window.start
            ? -1
            : 1
      );
  }, [tasks, windows, calendar, weekDays, weekFrom, weekTo]);

  const cardByTask = useMemo(() => new Map(cards.map((c) => [c.task.id, c])), [cards]);
  const pickedCard = picked != null ? cardByTask.get(picked) : undefined;
  const openedCard = opened != null ? cardByTask.get(opened) : undefined;

  /** Person -> day -> the phases they're booked on that day, this week. */
  const byPerson = useMemo(() => {
    const out = new Map<string, Map<string, { task: ScheduleTaskRow; startTime: string | null }[]>>();
    for (const { task } of cards) {
      const times = dayTimeMap(task.day_times ?? []);
      for (const c of task.crew_days ?? []) {
        if (c.day < weekFrom || c.day > weekTo) continue;
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
  }, [cards, weekFrom, weekTo]);

  // Weekend columns only appear when there's actually weekend work booked, so a
  // normal week stays five columns wide and nobody reads Saturday into the plan.
  const showWeekend = useMemo(
    () =>
      [weekDays[5], weekDays[6]].some(
        (d) =>
          [...byPerson.values()].some((days) => (days.get(d)?.length ?? 0) > 0) ||
          (pickedCard?.days.includes(d) ?? false)
      ),
    [byPerson, weekDays, pickedCard]
  );
  const columns = showWeekend ? weekDays : weekDays.slice(0, 5);

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

  const gridTemplate = `minmax(150px, 200px) repeat(${columns.length}, minmax(130px, 1fr))`;
  const bookedPeople = people.filter((p) => p.bookedCount > 0).length;
  const understaffed = cards.filter((c) => c.budget.remaining > 0).length;

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
            onClick={() => setMonday(addDays(monday, -7))}
            aria-label="Previous week"
          >
            ‹
          </button>
          <button
            className="border-x border-black/10 px-3 py-2 text-sm font-medium text-brand-ink hover:bg-black/5"
            onClick={() => setMonday(weekStart(today()))}
          >
            This Week
          </button>
          <button
            className="px-3 py-2 text-sm font-medium text-brand-gray hover:bg-black/5"
            onClick={() => setMonday(addDays(monday, 7))}
            aria-label="Next week"
          >
            ›
          </button>
        </div>

        <p className="text-sm font-semibold text-brand-ink">
          {weekLabel(monday)}
          <span className="ml-2 font-normal text-brand-gray">
            {bookedPeople === 0
              ? 'nobody booked'
              : `${bookedPeople} ${bookedPeople === 1 ? 'person' : 'people'} booked`}
            {understaffed > 0 &&
              ` · ${understaffed} ${understaffed === 1 ? 'job still needs' : 'jobs still need'} crew`}
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

      {/* Job cards: the work needing crew this week, and the budget left on each. */}
      {cards.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="font-semibold text-brand-ink">No jobs run this week</p>
          <p className="mt-1 text-sm text-brand-gray">
            Plan work on the Job Timeline — how long it runs and how many people it needs — and its
            card will appear here to staff.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => {
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
                  title={active ? 'Stop booking this job' : 'Book crew onto this job'}
                >
                  <p className="truncate text-sm font-semibold text-brand-ink">
                    {c.task.project_name}
                  </p>
                  <p className="truncate text-xs text-brand-gray">
                    {c.task.name} · {c.task.customer}
                  </p>
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

      {people.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-semibold text-brand-ink">Nobody to show</p>
          <p className="mt-1 text-sm text-brand-gray">
            Nobody is booked for {weekLabel(monday)}. Tick &ldquo;Show everyone&rdquo; to see the
            whole crew.
          </p>
        </div>
      ) : (
        <div className={`card overflow-hidden ${pending ? 'opacity-70' : ''}`}>
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
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
                      className={`border-l border-black/5 px-2 py-2 text-xs font-semibold ${
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
                    // A cell can take the picked job when that job runs that day
                    // and still has budget — or when it's already booked there,
                    // so clicking again takes them off.
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
                        className={`min-h-[64px] space-y-1 border-l border-black/5 p-1.5 ${
                          d === now ? 'bg-brand-green/5' : off ? 'bg-black/[.04]' : ''
                        } ${clash ? 'bg-red-50' : ''} ${
                          bookable ? 'cursor-pointer ring-1 ring-inset ring-brand-green/40 hover:bg-brand-green/10' : ''
                        }`}
                        onClick={bookable ? () => toggleCell(p, d) : undefined}
                        title={
                          bookable
                            ? on
                              ? `Take ${p.name} off ${pickedCard!.task.name}`
                              : `Book ${p.name} on ${pickedCard!.task.name}`
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
          — the budget is a total — but worth seeing before the week goes out. */}
      <HeavyDays cards={cards} />

      <p className="text-xs text-brand-gray">
        Pick a job card, then click the day cells of the people working it — the card&apos;s crew
        days count down as you go, and you can&apos;t book past what the timeline planned. Click a
        booking to take someone off that day. A day shaded red is one where somebody is on two
        different jobs. Open a card to set start times day by day and write what the crew needs to
        know.
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
