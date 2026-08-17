'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { shortDate } from '@/lib/format';
import { calendarSpan, computeSchedule, projectedEnd } from '@/lib/schedule-math';
import type { ScheduleTaskRow } from '@/lib/types';
import { TASK_STATUS_LABELS } from '@/lib/types';
import {
  TaskModal,
  type ProjectOption,
  type SubOption,
  type WorkerOption,
} from '@/app/(app)/schedule/TaskModal';

const STATUS_BADGE: Record<ScheduleTaskRow['status'], string> = {
  not_started: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-amber-100 text-amber-800',
  complete: 'bg-brand-green/20 text-brand-green-dark',
};
const STATUS_BAR: Record<ScheduleTaskRow['status'], string> = {
  not_started: 'bg-brand-gray',
  in_progress: 'bg-status-progress',
  complete: 'bg-brand-green',
};

/**
 * This job's phases in the order they actually happen, with a strip showing how
 * they overlap across the job's own span. Dates are derived from the dependency
 * chain by the same solver the Schedule page uses.
 */
export function ScheduleSection({
  project,
  tasks,
  workers,
  subs,
  holidays,
}: {
  project: ProjectOption;
  tasks: ScheduleTaskRow[];
  workers: WorkerOption[];
  subs: SubOption[];
  holidays: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ task?: ScheduleTaskRow } | null>(null);

  const { rows, projected, spanStart, spanDays } = useMemo(() => {
    const calendar = { holidays: new Set(holidays) };
    const { windows } = computeSchedule(tasks, calendar);
    const sorted = [...tasks]
      .map((task) => ({ task, dates: windows.get(task.id) }))
      .sort((a, b) => {
        const as = a.dates?.start ?? a.task.start_date;
        const bs = b.dates?.start ?? b.task.start_date;
        return as < bs ? -1 : as > bs ? 1 : a.task.position - b.task.position;
      });
    const end = projectedEnd(
      tasks.map((t) => t.id),
      windows
    );
    const start = sorted[0]?.dates?.start ?? null;
    return {
      rows: sorted,
      projected: end,
      spanStart: start,
      spanDays: start && end ? calendarSpan(start, end) : 0,
    };
  }, [tasks, holidays]);

  const slipping = !!(projected && project.due_date && projected > project.due_date);

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="brand-heading text-sm text-brand-gray">Schedule</h2>
        <button
          className="text-sm font-medium text-brand-green-dark hover:underline"
          onClick={() => setEditing({})}
        >
          + Add Phase
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-brand-gray">
          No phases scheduled yet. Add one to start building this job&apos;s timeline and projected
          finish date.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
                Projected Finish
              </span>
              <p
                className={`text-lg font-bold ${slipping ? 'text-amber-700' : 'text-brand-ink'}`}
              >
                {shortDate(projected)}
              </p>
            </div>
            {project.due_date && (
              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
                  Due
                </span>
                <p className="text-lg font-bold text-brand-ink">{shortDate(project.due_date)}</p>
              </div>
            )}
            {slipping && (
              <p className="text-sm font-medium text-amber-700">
                The scheduled work runs past this job&apos;s due date.
              </p>
            )}
          </div>

          <div className="divide-y divide-black/5">
            {rows.map(({ task, dates }) => {
              // Each bar's position as a percentage of the job's whole span, so
              // the overlap between phases reads at a glance.
              const offset =
                dates && spanStart && spanDays
                  ? ((calendarSpan(spanStart, dates.start) - 1) / spanDays) * 100
                  : 0;
              const width =
                dates && spanDays ? (calendarSpan(dates.start, dates.end) / spanDays) * 100 : 0;
              return (
                <button
                  key={task.id}
                  onClick={() => setEditing({ task })}
                  className="block w-full py-3 text-left hover:bg-black/[.02]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-brand-ink">{task.name}</span>
                      <span className={`badge ${STATUS_BADGE[task.status]}`}>
                        {TASK_STATUS_LABELS[task.status]}
                      </span>
                      {dates?.driven && (
                        <span className="text-xs text-brand-gray">follows a phase</span>
                      )}
                    </span>
                    <span className="text-sm text-brand-gray">
                      {dates
                        ? `${shortDate(dates.start)} – ${shortDate(dates.end)}`
                        : shortDate(task.start_date)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-black/5">
                    <div
                      className={`h-full rounded-full ${STATUS_BAR[task.status]}`}
                      style={{ marginLeft: `${offset}%`, width: `${Math.max(width, 2)}%` }}
                    />
                  </div>
                  {task.assignees.length > 0 && (
                    <p className="mt-1.5 text-sm text-brand-gray">
                      {task.assignees.map((a) => a.name).join(', ')}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {editing && (
        <TaskModal
          task={editing.task}
          allTasks={tasks}
          projects={[project]}
          workers={workers}
          subs={subs}
          holidays={holidays}
          defaultProjectId={project.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
