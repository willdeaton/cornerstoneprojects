'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  DAY_LABELS,
  addDays,
  assigneeBookings,
  bookingsByDay,
  computeSchedule,
  eachDay,
  fromDay,
  isSplitPattern,
  isWorkingDay,
  maskLabel,
  today,
  weekLabel,
  weekStart,
  type AssigneeBooking,
} from '@/lib/schedule-math';
import type { ScheduleTaskRow } from '@/lib/types';
import type { SubOption, WorkerOption } from './TaskModal';

/**
 * One week, one row per person: what each Cornerstone employee is doing each day.
 *
 * Built from day-level bookings rather than phase windows, so it shows the truth
 * about split weeks — someone on a job Mon/Wed and another Tuesday appears on
 * exactly those days — and a day nobody works is visibly empty instead of being
 * covered by a bar that runs straight through it.
 */
export function CrewWeek({
  tasks,
  workers,
  subs,
  holidays,
}: {
  tasks: ScheduleTaskRow[];
  workers: WorkerOption[];
  subs: SubOption[];
  holidays: string[];
}) {
  const [monday, setMonday] = useState<string>(() => weekStart(today()));
  const [showIdle, setShowIdle] = useState(true);
  const [includeSubs, setIncludeSubs] = useState(false);

  const calendar = useMemo(() => ({ holidays: new Set(holidays) }), [holidays]);
  const now = today();

  const { windows } = useMemo(() => computeSchedule(tasks, calendar), [tasks, calendar]);

  // Every booked day in this week, indexed person -> day.
  const weekDays = useMemo(() => eachDay(monday, addDays(monday, 6)), [monday]);
  const byPerson = useMemo(() => {
    const bookings = assigneeBookings(tasks, windows, calendar).filter(
      (b) => b.start <= weekDays[6] && b.end >= weekDays[0]
    );
    return bookingsByDay(bookings);
  }, [tasks, windows, calendar, weekDays]);

  // Weekend columns only appear when there's actually weekend work booked, so a
  // normal week stays five columns wide and nobody reads Saturday into the plan.
  const showWeekend = useMemo(
    () =>
      [weekDays[5], weekDays[6]].some((d) =>
        [...byPerson.values()].some((days) => (days.get(d)?.length ?? 0) > 0)
      ),
    [byPerson, weekDays]
  );
  const columns = showWeekend ? weekDays : weekDays.slice(0, 5);

  const people = useMemo(() => {
    const rows = [
      ...workers.map((w) => ({
        key: `user:${w.id}`,
        name: w.name,
        detail: w.role,
        internal: true,
      })),
      ...(includeSubs
        ? subs.map((s) => ({
            key: `sub:${s.id}`,
            name: s.name,
            detail: s.trade ?? 'Subcontractor',
            internal: false,
          }))
        : []),
    ];
    return rows
      .map((p) => {
        const days = byPerson.get(p.key) ?? new Map<string, AssigneeBooking[]>();
        const booked = columns.filter((d) => (days.get(d)?.length ?? 0) > 0);
        // Two different jobs on one day is a real double-booking; two phases of
        // the same job is just one crew doing two things there.
        const clashes = columns.filter(
          (d) => new Set((days.get(d) ?? []).map((b) => b.projectId)).size > 1
        );
        return { ...p, days, bookedCount: booked.length, clashes };
      })
      .filter((p) => showIdle || p.bookedCount > 0)
      .sort((a, b) =>
        a.internal === b.internal ? a.name.localeCompare(b.name) : a.internal ? -1 : 1
      );
  }, [workers, subs, includeSubs, byPerson, columns, showIdle]);

  const gridTemplate = `minmax(150px, 200px) repeat(${columns.length}, minmax(120px, 1fr))`;
  const bookedPeople = people.filter((p) => p.bookedCount > 0).length;

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

      {people.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-semibold text-brand-ink">Nobody is booked this week</p>
          <p className="mt-1 text-sm text-brand-gray">
            Nothing is scheduled for {weekLabel(monday)}.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
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
                    const clash = new Set(items.map((b) => b.projectId)).size > 1;
                    return (
                      <div
                        key={d}
                        className={`min-h-[64px] space-y-1 border-l border-black/5 p-1.5 ${
                          d === now ? 'bg-brand-green/5' : off ? 'bg-black/[.04]' : ''
                        } ${clash ? 'bg-red-50' : ''}`}
                      >
                        {items.map((b) => (
                          <Link
                            key={`${b.taskId}-${b.start}`}
                            href={`/projects/${b.projectId}`}
                            title={`${b.projectName} — ${b.taskName}${
                              b.location ? `\n${b.location}` : ''
                            }${
                              isSplitPattern(b.workDays)
                                ? `\nDays on this job: ${maskLabel(b.workDays)}`
                                : ''
                            }`}
                            className={`block rounded px-1.5 py-1 text-[11px] leading-tight ${
                              STATUS_CHIP[b.taskStatus]
                            }`}
                          >
                            <span className="block truncate font-semibold">{b.projectName}</span>
                            <span className="block truncate opacity-90">{b.taskName}</span>
                            {isSplitPattern(b.workDays) && (
                              <span className="block truncate opacity-75">
                                {maskLabel(b.workDays)} only
                              </span>
                            )}
                          </Link>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-brand-gray">
        One row per person, one column per day — so a week split across jobs reads exactly as it is.
        Weekend columns only appear when weekend work is actually booked, and a day shaded red is one
        where someone is on two different jobs. Set someone&apos;s days on a phase in the phase
        editor.
      </p>
    </div>
  );
}

const STATUS_CHIP: Record<AssigneeBooking['taskStatus'], string> = {
  not_started: 'bg-brand-gray/15 text-brand-ink hover:bg-brand-gray/25',
  in_progress: 'bg-status-progress/20 text-brand-ink hover:bg-status-progress/30',
  complete: 'bg-brand-green/20 text-brand-green-dark hover:bg-brand-green/30',
};
