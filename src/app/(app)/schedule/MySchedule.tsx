'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { shortDate } from '@/lib/format';
import { addDays, computeSchedule, rangesOverlap, today } from '@/lib/schedule-math';
import type { ScheduleTaskRow } from '@/lib/types';
import { TASK_STATUS_LABELS } from '@/lib/types';

/** How far ahead a worker's own view looks. */
const LOOKAHEAD_DAYS = 14;

/**
 * A worker's read-only view: the phases they're on that touch the next two
 * weeks. Dates come from the same solver the manager timeline uses, so what a
 * worker sees always matches the board.
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
    return tasks
      .filter((t) => t.assignees.some((a) => a.kind === 'user' && a.ref_id === userId))
      .map((t) => ({ task: t, dates: windows.get(t.id) }))
      .filter(
        (row): row is { task: ScheduleTaskRow; dates: { start: string; end: string; driven: boolean } } =>
          !!row.dates && rangesOverlap(row.dates.start, row.dates.end, from, to)
      )
      .sort((a, b) => (a.dates.start < b.dates.start ? -1 : a.dates.start > b.dates.start ? 1 : 0));
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
      {mine.map(({ task, dates }) => {
        const crew = task.assignees.filter((a) => !(a.kind === 'user' && a.ref_id === userId));
        return (
          <div key={task.id} className="card p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
                  {dates.start === dates.end
                    ? shortDate(dates.start)
                    : `${shortDate(dates.start)} – ${shortDate(dates.end)}`}
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
                    With {crew.map((a) => a.name).join(', ')}
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
