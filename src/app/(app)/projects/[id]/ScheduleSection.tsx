'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { shortDate } from '@/lib/format';
import {
  calendarSpan,
  computeSchedule,
  isSplitPattern,
  maskLabel,
  projectedEnd,
  workedSegments,
} from '@/lib/schedule-math';
import type { ScheduleChange, ScheduleTaskRow } from '@/lib/types';
import { TASK_STATUS_LABELS } from '@/lib/types';
import {
  TaskModal,
  type ProjectOption,
  type SubOption,
  type WorkerOption,
} from '@/app/(app)/schedule/TaskModal';
import { PublishBar, ScheduleHistory, type PublishedInfo } from '@/app/(app)/schedule/PublishBar';

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
  published = null,
  changes = [],
  canUnpublish = false,
}: {
  project: ProjectOption;
  tasks: ScheduleTaskRow[];
  workers: WorkerOption[];
  subs: SubOption[];
  holidays: string[];
  /** Publish state for this job, or null if its schedule hasn't gone out. */
  published?: PublishedInfo | null;
  /** Reasons logged since it was published, newest first. */
  changes?: ScheduleChange[];
  canUnpublish?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ task?: ScheduleTaskRow } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const { rows, projected, spanStart, spanDays } = useMemo(() => {
    const calendar = { holidays: new Set(holidays) };
    const { windows } = computeSchedule(tasks, calendar);
    const sorted = [...tasks]
      .map((task) => {
        const dates = windows.get(task.id);
        return {
          task,
          dates,
          // The stretches actually worked, so the strip breaks at weekends
          // instead of implying Saturday and Sunday on site.
          segments: dates ? workedSegments(dates.start, dates.end, calendar) : [],
        };
      })
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
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="brand-heading text-sm text-brand-gray">Schedule</h2>
          <PublishBar
            projectId={project.id}
            projectName={project.name}
            published={published}
            canUnpublish={canUnpublish}
            compact={false}
          />
        </div>
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
            {rows.map(({ task, dates, segments }) => (
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
                      <span className="text-xs text-brand-gray">
                        {task.depends_type === 'start_to_start'
                          ? 'runs alongside a phase'
                          : 'follows a phase'}
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-brand-gray">
                    {dates
                      ? `${shortDate(dates.start)} – ${shortDate(dates.end)}`
                      : shortDate(task.start_date)}
                  </span>
                </div>
                {/* One block per working stretch, positioned across the job's
                    whole span — the gaps are the weekends. */}
                <div className="relative mt-1.5 h-2 w-full overflow-hidden rounded-full bg-black/5">
                  {segments.map((s) => {
                    const offset =
                      spanStart && spanDays
                        ? ((calendarSpan(spanStart, s.start) - 1) / spanDays) * 100
                        : 0;
                    const width = spanDays ? (calendarSpan(s.start, s.end) / spanDays) * 100 : 0;
                    return (
                      <div
                        key={s.start}
                        className={`absolute top-0 h-full rounded-full ${STATUS_BAR[task.status]}`}
                        style={{ left: `${offset}%`, width: `${Math.max(width, 1.5)}%` }}
                      />
                    );
                  })}
                </div>
                {task.assignees.length > 0 && (
                  <p className="mt-1.5 text-sm text-brand-gray">
                    {task.assignees
                      .map((a) =>
                        isSplitPattern(a.work_days) ? `${a.name} (${maskLabel(a.work_days)})` : a.name
                      )
                      .join(', ')}
                  </p>
                )}
              </button>
            ))}
          </div>

          {published && (
            <div className="mt-4 border-t border-black/5 pt-3">
              <button
                className="text-sm font-medium text-brand-green-dark hover:underline"
                onClick={() => setShowHistory((s) => !s)}
              >
                {showHistory ? 'Hide' : 'Show'} change history
                {changes.length > 0 ? ` (${changes.length})` : ''}
              </button>
              {showHistory && (
                <div className="mt-2">
                  <ScheduleHistory changes={changes} />
                </div>
              )}
            </div>
          )}
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
          publishedVersions={published ? { [project.id]: published.version } : undefined}
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
