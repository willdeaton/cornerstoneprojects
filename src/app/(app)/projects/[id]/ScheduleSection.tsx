'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { shortDate } from '@/lib/format';
import {
  calendarSpan,
  computeSchedule,
  crewBudget,
  crewRoster,
  projectedEnd,
  shiftLabel,
  workedSegments,
} from '@/lib/schedule-math';
import { useScheduleLive } from '@/components/useScheduleLive';
import type { ScheduleChange, ScheduleTaskRow } from '@/lib/types';
import { TASK_STATUS_LABELS } from '@/lib/types';
import {
  TaskModal,
  type ProjectOption,
  type SubOption,
} from '@/app/(app)/schedule/TaskModal';

import { PublishBar, ScheduleHistory, type PublishedInfo } from '@/app/(app)/schedule/PublishBar';
import { HardFinishControl } from '@/app/(app)/schedule/HardFinishControl';
import { OnHoldControl } from '@/app/(app)/schedule/OnHoldControl';

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
 *
 * The change history sits at the bottom whether or not the schedule has been
 * published — every move of these dates is recorded with the reason for it.
 */
export function ScheduleSection({
  project,
  tasks,
  subs,
  holidays,
  published = null,
  changes = [],
  canUnpublish = false,
}: {
  project: ProjectOption;
  tasks: ScheduleTaskRow[];
  /** The subcontractor catalog, for phases that get contracted out. */
  subs: SubOption[];
  holidays: string[];
  /** Publish state for this job, or null if its schedule hasn't gone out. */
  published?: PublishedInfo | null;
  /** Reasons logged against this job, newest first — publishing isn't required. */
  changes?: ScheduleChange[];
  canUnpublish?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ task?: ScheduleTaskRow } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // A job's own phases move when somebody moves them on the schedule board.
  useScheduleLive();

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
  const missingHardFinish = !!(
    projected &&
    project.hard_finish_date &&
    projected > project.hard_finish_date
  );

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="brand-heading text-sm text-brand-gray">Schedule</h2>
          <PublishBar
            projectId={project.id}
            projectName={project.name}
            published={published}
            changeCount={changes.length}
            canUnpublish={canUnpublish}
            compact={false}
          />
          <HardFinishControl
            projectId={project.id}
            projectName={project.name}
            hardFinishDate={project.hard_finish_date ?? null}
            projectedEnd={projected}
            compact={false}
          />
          <OnHoldControl
            projectId={project.id}
            projectName={project.name}
            onHold={!!project.on_hold}
            reason={project.on_hold_reason ?? null}
            since={project.on_hold_since ?? null}
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
                className={`text-lg font-bold ${
                  missingHardFinish ? 'text-red-700' : slipping ? 'text-amber-700' : 'text-brand-ink'
                }`}
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
            {project.hard_finish_date && (
              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
                  Must Finish By
                </span>
                <p
                  className={`text-lg font-bold ${
                    missingHardFinish ? 'text-red-700' : 'text-brand-ink'
                  }`}
                >
                  {shortDate(project.hard_finish_date)}
                </p>
              </div>
            )}
            {missingHardFinish && (
              <p className="text-sm font-semibold text-red-700">
                The scheduled work runs past the date this job has to be finished by.
              </p>
            )}
            {slipping && !missingHardFinish && (
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
                {(() => {
                  // Crew reads as the ask and how much of it the crew week has
                  // covered — the names come second, since it's the shortfall
                  // that needs acting on.
                  const budget = crewBudget(task, dates, { holidays: new Set(holidays) });
                  const roster = crewRoster(task);
                  return (
                    <>
                      {task.subcontractor_name && (
                        <p className="mt-1.5 text-sm font-medium text-brand-ink">
                          Subcontracted to {task.subcontractor_name}
                        </p>
                      )}
                      {budget.capacity > 0 && (
                        <p className="mt-1.5 text-sm font-medium text-brand-ink">
                          {task.subcontractor_name ? 'Plus ' : ''}
                          {budget.needed} of ours a day · {budget.filled}/{budget.capacity} crew
                          days booked
                          {budget.remaining > 0 && (
                            <span className="text-amber-700">
                              {' '}
                              · {budget.remaining} still to book
                            </span>
                          )}
                        </p>
                      )}
                      {(task.start_time ||
                        task.hours != null ||
                        (task.day_times ?? []).length > 0) && (
                        <p className="mt-0.5 text-sm text-brand-ink">
                          {task.start_time || task.hours != null
                            ? `${shiftLabel({
                                startTime: task.start_time,
                                hours: task.hours,
                              })} daily`
                            : 'Shift set on some days'}
                          {(task.day_times ?? []).length > 0 &&
                            ` · ${task.day_times.length} day${
                              task.day_times.length === 1 ? '' : 's'
                            } with their own shift`}
                        </p>
                      )}
                      {roster.length > 0 && (
                        <p className="mt-0.5 text-sm text-brand-gray">
                          {roster
                            .map((a) => `${a.name} (${a.days} ${a.days === 1 ? 'day' : 'days'})`)
                            .join(', ')}
                        </p>
                      )}
                    </>
                  );
                })()}
              </button>
            ))}
          </div>

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
        </>
      )}

      {editing && (
        <TaskModal
          task={editing.task}
          allTasks={tasks}
          projects={[project]}
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
