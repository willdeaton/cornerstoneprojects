'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { dateTime, shortDate } from '@/lib/format';
import {
  DAY_LABELS,
  addDays,
  assigneeBookings,
  bookingsByDay,
  computeSchedule,
  crewRoster,
  eachDay,
  fromDay,
  isWorkingDay,
  timeLabel,
  today,
  weekLabel,
  weekStart,
  type AssigneeBooking,
} from '@/lib/schedule-math';
import type { CrewNote, ScheduleTaskRow } from '@/lib/types';
import { TASK_STATUS_LABELS } from '@/lib/types';

/**
 * A worker's own schedule, one week at a time.
 *
 * The week is the unit the crew actually works to, so this opens on the current
 * week and steps back and forward through them rather than showing a rolling
 * fortnight — someone can look at next week on its own and see exactly what
 * they're doing, day by day, including what time they start and where.
 *
 * Dates come from the same solver the manager timeline uses, and days are built
 * from the crew-day rows themselves, so a week split across jobs shows only the
 * days that are actually theirs.
 */
export function MySchedule({
  tasks,
  holidays,
  userId,
  crewNotes = [],
}: {
  tasks: ScheduleTaskRow[];
  holidays: string[];
  userId: number;
  /** Job-specific notes for the crew, for the jobs this person is booked on. */
  crewNotes?: CrewNote[];
}) {
  const [monday, setMonday] = useState<string>(() => weekStart(today()));
  const now = today();

  const weekDays = useMemo(() => eachDay(monday, addDays(monday, 6)), [monday]);
  const calendar = useMemo(() => ({ holidays: new Set(holidays) }), [holidays]);

  // Every day this person is booked, this week, with the phase behind it.
  const { byDay, jobIds, bookedDays } = useMemo(() => {
    const { windows } = computeSchedule(tasks, calendar);
    const mine = assigneeBookings(tasks, windows, calendar).filter(
      (b) =>
        b.kind === 'user' &&
        b.refId === userId &&
        b.start <= weekDays[6] &&
        b.end >= weekDays[0]
    );
    const indexed = bookingsByDay(mine).get(`user:${userId}`) ?? new Map<string, AssigneeBooking[]>();
    const days = weekDays.filter((d) => (indexed.get(d)?.length ?? 0) > 0);
    return {
      byDay: indexed,
      jobIds: new Set(mine.map((b) => b.projectId)),
      bookedDays: days,
    };
  }, [tasks, calendar, userId, weekDays]);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // Crew notes for the jobs in this week only — messages about a job someone
  // isn't on this week are just noise.
  const notesByJob = useMemo(() => {
    const out = new Map<number, CrewNote[]>();
    for (const n of crewNotes) {
      if (!jobIds.has(n.project_id)) continue;
      const list = out.get(n.project_id);
      if (list) list.push(n);
      else out.set(n.project_id, [n]);
    }
    return out;
  }, [crewNotes, jobIds]);

  const thisWeek = monday === weekStart(now);

  return (
    <div className="space-y-4">
      {/* Week switcher */}
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
            onClick={() => setMonday(weekStart(now))}
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
            {thisWeek ? 'this week · ' : ''}
            {bookedDays.length === 0
              ? 'nothing booked'
              : `${bookedDays.length} ${bookedDays.length === 1 ? 'day' : 'days'} booked`}
          </span>
        </p>
      </div>

      {bookedDays.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-semibold text-brand-ink">Nothing scheduled</p>
          <p className="mt-1 text-sm text-brand-gray">
            You have no work booked for {weekLabel(monday)}. Use the arrows to look at another week.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookedDays.map((day) => {
            const items = byDay.get(day) ?? [];
            const off = !isWorkingDay(day, calendar);
            return (
              <div key={day} className="card p-5">
                <div className="mb-3 flex flex-wrap items-baseline gap-2 border-b border-black/5 pb-2">
                  <h3
                    className={`font-semibold ${
                      day === now ? 'text-brand-green-dark' : 'text-brand-ink'
                    }`}
                  >
                    {DAY_LABELS[fromDay(day).getDay()]},{' '}
                    {fromDay(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </h3>
                  {day === now && (
                    <span className="badge bg-brand-green/20 text-brand-green-dark">Today</span>
                  )}
                  {off && <span className="text-xs text-brand-gray">weekend / non-working day</span>}
                </div>

                <div className="space-y-4">
                  {items.map((b) => {
                    const task = taskById.get(b.taskId);
                    // Who else is on this phase at all — not only today, so the
                    // card reads as "the crew you're with on this job".
                    const others = task
                      ? crewRoster(task).filter((a) => !(a.kind === 'user' && a.refId === userId))
                      : [];
                    const notes = notesByJob.get(b.projectId) ?? [];
                    return (
                      <div key={`${b.taskId}-${b.start}`} className="min-w-0">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-brand-ink">
                              {b.startTime ? `Start ${timeLabel(b.startTime)}` : 'No set start time'}
                            </p>
                            <h4 className="mt-0.5 font-semibold text-brand-ink">
                              {b.taskName}
                              <span className="font-normal text-brand-gray">
                                {' '}
                                · {b.projectName}
                              </span>
                            </h4>
                            <p className="mt-0.5 text-sm text-brand-gray">{b.customer}</p>
                            {b.siteAddress ? (
                              <a
                                href={mapsUrl(b.siteAddress)}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-0.5 block text-sm font-medium text-brand-green-dark hover:underline"
                              >
                                {b.siteAddress}
                              </a>
                            ) : (
                              b.location && (
                                <p className="mt-0.5 text-sm text-brand-gray">{b.location}</p>
                              )
                            )}
                            {b.taskNotes && (
                              <p className="mt-2 text-sm text-brand-ink">{b.taskNotes}</p>
                            )}
                            {others.length > 0 && (
                              <p className="mt-2 text-sm text-brand-gray">
                                With {others.map((a) => a.name).join(', ')}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="badge bg-gray-100 text-gray-700">
                              {TASK_STATUS_LABELS[b.taskStatus]}
                            </span>
                            <Link
                              href={`/projects/${b.projectId}`}
                              className="text-sm font-medium text-brand-green-dark hover:underline"
                            >
                              Job
                            </Link>
                          </div>
                        </div>

                        {notes.length > 0 && (
                          <div className="mt-3 rounded-lg border border-brand-green/30 bg-brand-green/5 px-3 py-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-brand-green-dark">
                              Notes for the crew
                            </p>
                            <ul className="mt-1 space-y-1.5">
                              {notes.map((n) => (
                                <li key={n.id} className="text-sm text-brand-ink">
                                  {n.pinned && (
                                    <span className="mr-1 font-semibold text-brand-green-dark">
                                      Important:
                                    </span>
                                  )}
                                  {n.body}
                                  <span className="ml-1 text-xs text-brand-gray">
                                    — {n.author_name}, {dateTime(n.created_at)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-brand-gray">
        One card per day you&apos;re booked, with the time you start and the address to drive to.
        Dates can shift as jobs move — check with your manager before making plans around them.
      </p>
    </div>
  );
}

/** A tappable directions link for an address typed by hand. */
function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
