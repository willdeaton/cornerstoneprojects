'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { shortDate } from '@/lib/format';
import {
  addDays,
  assigneeBookings,
  computeSchedule,
  isSplitPattern,
  maskLabel,
  rangesOverlap,
  today,
} from '@/lib/schedule-math';
import type { ScheduleTaskRow } from '@/lib/types';
import { TASK_STATUS_LABELS } from '@/lib/types';

/** How far ahead a worker's own view looks. */
const LOOKAHEAD_DAYS = 14;

/**
 * A worker's read-only view: the days they're booked over the next two weeks.
 * Dates come from the same solver the manager timeline uses, and one card per
 * worked stretch — so a job that carries into next week reads as two entries
 * with the weekend off, and a split week shows only the days that are theirs.
 */
export function MySchedule({
  tasks,
  holidays,
  userId,
}: {
  tasks: ScheduleTaskRow[];
  holidays: string[];
  userId: number;
}) {
  const from = today();
  const to = addDays(from, LOOKAHEAD_DAYS);

  const mine = useMemo(() => {
    const calendar = { holidays: new Set(holidays) };
    const { windows } = computeSchedule(tasks, calendar);
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    return assigneeBookings(tasks, windows, calendar)
      .filter(
        (b) =>
          b.kind === 'user' && b.refId === userId && rangesOverlap(b.start, b.end, from, to)
      )
      .map((b) => ({ booking: b, task: taskById.get(b.taskId)! }))
      .sort((a, b) =>
        a.booking.start < b.booking.start ? -1 : a.booking.start > b.booking.start ? 1 : 0
      );
  }, [tasks, holidays, userId, from, to]);

  if (mine.length === 0) {
    return (
      <div className="card p-10 text-center">
        <p className="font-semibold text-brand-ink">Nothing scheduled</p>
        <p className="mt-1 text-sm text-brand-gray">
          You have no work booked between {shortDate(from)} and {shortDate(to)}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {mine.map(({ task, booking }) => {
        const crew = task.assignees.filter((a) => !(a.kind === 'user' && a.ref_id === userId));
        return (
          <div key={`${task.id}-${booking.start}`} className="card p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
                  {booking.start === booking.end
                    ? shortDate(booking.start)
                    : `${shortDate(booking.start)} – ${shortDate(booking.end)}`}
                  {isSplitPattern(booking.workDays) && (
                    <span className="ml-2 font-medium normal-case text-brand-green-dark">
                      your days: {maskLabel(booking.workDays)}
                    </span>
                  )}
                </p>
                <h3 className="mt-1 font-semibold text-brand-ink">
                  {task.name}
                  <span className="font-normal text-brand-gray"> · {task.project_name}</span>
                </h3>
                <p className="mt-0.5 text-sm text-brand-gray">
                  {task.customer}
                  {task.location ? ` · ${task.location}` : ''}
                </p>
                {task.notes && <p className="mt-2 text-sm text-brand-ink">{task.notes}</p>}
                {crew.length > 0 && (
                  <p className="mt-2 text-sm text-brand-gray">
                    With{' '}
                    {crew
                      .map((a) =>
                        isSplitPattern(a.work_days)
                          ? `${a.name} (${maskLabel(a.work_days)})`
                          : a.name
                      )
                      .join(', ')}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="badge bg-gray-100 text-gray-700">
                  {TASK_STATUS_LABELS[task.status]}
                </span>
                <Link
                  href={`/projects/${task.project_id}`}
                  className="text-sm font-medium text-brand-green-dark hover:underline"
                >
                  Job
                </Link>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
