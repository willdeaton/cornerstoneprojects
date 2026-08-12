'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { shortDate } from '@/lib/format';
import {
  addDays,
  assigneeWindows,
  computeSchedule,
  conflictedTaskIds,
  eachDay,
  findConflicts,
  fromDay,
  isWeekend,
  projectedEnd,
  rangesOverlap,
  today,
  type ComputedWindow,
} from '@/lib/schedule-math';
import type { ScheduleTaskRow } from '@/lib/types';
import { TaskModal, type ProjectOption, type SubOption, type WorkerOption } from './TaskModal';
import { SendScheduleModal } from './SendScheduleModal';

/** Timeline widths offered by the range switcher. */
const SPANS = [
  { days: 7, label: 'Week' },
  { days: 14, label: '2 Weeks' },
  { days: 42, label: '6 Weeks' },
] as const;

const DEFAULT_SPAN = 14;

type Editing = { task?: ScheduleTaskRow } | null;

/**
 * Where the timeline opens. Today, unless nothing is scheduled in that window —
 * then it jumps to the next work there is, so the board never opens blank while
 * a job sits a month out.
 */
function initialAnchor(tasks: ScheduleTaskRow[], holidays: string[]): string {
  const now = today();
  if (tasks.length === 0) return now;
  const { windows } = computeSchedule(tasks, { holidays: new Set(holidays) });
  const all = [...windows.values()];
  if (all.some((w) => rangesOverlap(w.start, w.end, now, addDays(now, DEFAULT_SPAN - 1)))) {
    return now;
  }
  const starts = all
    .filter((w) => w.end >= now)
    .map((w) => w.start)
    .sort();
  if (starts.length > 0) return starts[0];
  // Everything is in the past — show the most recent work instead.
  return all.map((w) => w.start).sort().at(-1) ?? now;
}

export function ScheduleBoard({
  tasks,
  projects,
  workers,
  subs,
  holidays,
}: {
  tasks: ScheduleTaskRow[];
  projects: ProjectOption[];
  workers: WorkerOption[];
  subs: SubOption[];
  holidays: string[];
}) {
  const router = useRouter();
  const [spanDays, setSpanDays] = useState<number>(DEFAULT_SPAN);
  const [anchor, setAnchor] = useState<string>(() => initialAnchor(tasks, holidays));
  const [projectFilter, setProjectFilter] = useState<number | 'all'>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [editing, setEditing] = useState<Editing>(null);
  const [sending, setSending] = useState(false);

  const calendar = useMemo(() => ({ holidays: new Set(holidays) }), [holidays]);
  const holidaySet = calendar.holidays;

  // Real dates for every phase, derived from the dependency chains. Computed
  // here rather than on the server so the same solver drives the phase editor's
  // live preview — one set of rules, one place.
  const { windows } = useMemo(() => computeSchedule(tasks, calendar), [tasks, calendar]);

  const conflicts = useMemo(
    () => findConflicts(assigneeWindows(tasks, windows)),
    [tasks, windows]
  );
  const conflictedTasks = useMemo(() => conflictedTaskIds(conflicts), [conflicts]);

  const days = useMemo(() => eachDay(anchor, addDays(anchor, spanDays - 1)), [anchor, spanDays]);
  const rangeStart = days[0];
  const rangeEnd = days[days.length - 1];
  const now = today();

  const visible = useMemo(
    () =>
      tasks.filter((t) => {
        if (projectFilter !== 'all' && t.project_id !== projectFilter) return false;
        if (
          assigneeFilter !== 'all' &&
          !t.assignees.some((a) => `${a.kind}:${a.ref_id}` === assigneeFilter)
        ) {
          return false;
        }
        return true;
      }),
    [tasks, projectFilter, assigneeFilter]
  );

  // One group per job, ordered by when its work actually starts.
  const groups = useMemo(() => {
    const byProject = new Map<number, ScheduleTaskRow[]>();
    for (const t of visible) {
      const list = byProject.get(t.project_id);
      if (list) list.push(t);
      else byProject.set(t.project_id, [t]);
    }
    return [...byProject.values()]
      .map((list) => {
        const sorted = [...list].sort((a, b) => {
          const aw = windows.get(a.id)?.start ?? a.start_date;
          const bw = windows.get(b.id)?.start ?? b.start_date;
          return aw < bw ? -1 : aw > bw ? 1 : a.position - b.position;
        });
        const end = projectedEnd(
          sorted.map((t) => t.id),
          windows
        );
        const head = sorted[0];
        return {
          projectId: head.project_id,
          projectName: head.project_name,
          customer: head.customer,
          dueDate: head.project_due_date,
          projected: end,
          slipping: !!(end && head.project_due_date && end > head.project_due_date),
          tasks: sorted,
        };
      })
      .sort((a, b) => {
        const as = windows.get(a.tasks[0].id)?.start ?? '';
        const bs = windows.get(b.tasks[0].id)?.start ?? '';
        return as < bs ? -1 : as > bs ? 1 : 0;
      });
  }, [visible, windows]);

  const assigneeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of tasks) {
      for (const a of t.assignees) seen.set(`${a.kind}:${a.ref_id}`, a.name);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  // 220px of labels, then one equal column per day.
  const gridTemplate = `minmax(200px, 220px) repeat(${days.length}, minmax(26px, 1fr))`;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-black/10">
          <button
            className="px-3 py-2 text-sm font-medium text-brand-gray hover:bg-black/5"
            onClick={() => setAnchor(addDays(anchor, -spanDays))}
            aria-label="Earlier"
          >
            ‹
          </button>
          <button
            className="border-x border-black/10 px-3 py-2 text-sm font-medium text-brand-ink hover:bg-black/5"
            onClick={() => setAnchor(today())}
          >
            Today
          </button>
          <button
            className="px-3 py-2 text-sm font-medium text-brand-gray hover:bg-black/5"
            onClick={() => setAnchor(addDays(anchor, spanDays))}
            aria-label="Later"
          >
            ›
          </button>
        </div>

        <div className="flex overflow-hidden rounded-lg border border-black/10">
          {SPANS.map((s) => (
            <button
              key={s.days}
              onClick={() => setSpanDays(s.days)}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                spanDays === s.days
                  ? 'bg-brand-green text-white'
                  : 'text-brand-gray hover:bg-black/5'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <select
          className="input w-auto"
          value={projectFilter}
          onChange={(e) =>
            setProjectFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
          }
        >
          <option value="all">All jobs</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          className="input w-auto"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
        >
          <option value="all">Everyone</option>
          {assigneeOptions.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>

        <div className="ml-auto flex gap-2">
          <button className="btn-secondary" onClick={() => setSending(true)}>
            Send Schedule
          </button>
          <button
            className="btn-primary"
            onClick={() => setEditing({})}
            disabled={projects.length === 0}
            title={projects.length === 0 ? 'Create a project first' : undefined}
          >
            + Schedule Work
          </button>
        </div>
      </div>

      {conflicts.length > 0 && <ConflictStrip conflicts={conflicts} />}

      {groups.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-semibold text-brand-ink">Nothing scheduled yet</p>
          <p className="mt-1 text-sm text-brand-gray">
            {tasks.length === 0
              ? 'Add a phase to a job to start building the schedule.'
              : 'No scheduled work matches these filters.'}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              {/* Date header */}
              <div
                className="grid border-b border-black/10 bg-black/[.02]"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                <div className="sticky left-0 z-20 bg-[#fafafa] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">
                  {monthLabel(rangeStart, rangeEnd)}
                </div>
                {days.map((d) => (
                  <div
                    key={d}
                    className={`border-l border-black/5 py-2 text-center text-[11px] leading-tight ${
                      d === now
                        ? 'font-bold text-brand-green-dark'
                        : isOff(d, holidaySet)
                          ? 'text-brand-gray/50'
                          : 'text-brand-gray'
                    }`}
                  >
                    <div>{fromDay(d).toLocaleDateString('en-US', { weekday: 'narrow' })}</div>
                    <div>{fromDay(d).getDate()}</div>
                  </div>
                ))}
              </div>

              {groups.map((g) => (
                <div key={g.projectId} className="border-b border-black/10 last:border-0">
                  {/* Job header row */}
                  <div className="grid bg-black/[.02]" style={{ gridTemplateColumns: gridTemplate }}>
                    <div className="sticky left-0 z-20 bg-[#fafafa] px-4 py-2">
                      <Link
                        href={`/projects/${g.projectId}`}
                        className="block truncate text-sm font-semibold text-brand-ink hover:text-brand-green-dark"
                      >
                        {g.projectName}
                      </Link>
                      <p className="truncate text-xs text-brand-gray">{g.customer}</p>
                      <p
                        className={`mt-0.5 text-xs font-medium ${
                          g.slipping ? 'text-amber-700' : 'text-brand-gray'
                        }`}
                        title={
                          g.slipping
                            ? `Projected finish is after the ${shortDate(g.dueDate)} due date`
                            : undefined
                        }
                      >
                        Ends {shortDate(g.projected)}
                        {g.slipping && ' · past due date'}
                      </p>
                    </div>
                    {days.map((d) => (
                      <div key={d} className={`border-l border-black/5 ${cellTint(d, holidaySet, now)}`} />
                    ))}
                  </div>

                  {/* One row per phase */}
                  {g.tasks.map((t) => (
                    <PhaseRow
                      key={t.id}
                      task={t}
                      dates={windows.get(t.id)}
                      days={days}
                      rangeStart={rangeStart}
                      rangeEnd={rangeEnd}
                      now={now}
                      holidaySet={holidaySet}
                      gridTemplate={gridTemplate}
                      conflicted={conflictedTasks.has(t.id)}
                      onEdit={() => setEditing({ task: t })}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-brand-gray">
        Weekends and non-working days are shaded and never count toward a phase&apos;s duration. A
        phase marked &ldquo;starts after&rdquo; another moves automatically when the one before it
        slips.
      </p>

      {editing && (
        <TaskModal
          task={editing.task}
          allTasks={tasks}
          projects={projects}
          workers={workers}
          subs={subs}
          holidays={holidays}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {sending && (
        <SendScheduleModal
          defaultFrom={rangeStart}
          defaultTo={rangeEnd}
          onClose={() => setSending(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- Phase row */

function PhaseRow({
  task,
  dates,
  days,
  rangeStart,
  rangeEnd,
  now,
  holidaySet,
  gridTemplate,
  conflicted,
  onEdit,
}: {
  task: ScheduleTaskRow;
  dates: ComputedWindow | undefined;
  days: string[];
  rangeStart: string;
  rangeEnd: string;
  now: string;
  holidaySet: Set<string>;
  gridTemplate: string;
  conflicted: boolean;
  onEdit: () => void;
}) {
  const crew = task.assignees.map((a) => a.name).join(', ');
  // Clip the bar to the visible range; a phase entirely outside it gets no bar,
  // and the row still shows its dates in the label column.
  const inView = !!dates && dates.start <= rangeEnd && dates.end >= rangeStart;
  const startIdx = dates ? days.indexOf(clamp(dates.start, rangeStart, rangeEnd)) : -1;
  const endIdx = dates ? days.indexOf(clamp(dates.end, rangeStart, rangeEnd)) : -1;
  const runsEarlier = !!dates && dates.start < rangeStart;
  const runsLater = !!dates && dates.end > rangeEnd;

  return (
    <div className="grid" style={{ gridTemplateColumns: gridTemplate }}>
      <button
        onClick={onEdit}
        className="sticky left-0 z-20 bg-white px-4 py-2 text-left hover:bg-black/[.03]"
      >
        <span className="flex items-center gap-1.5">
          {dates?.driven && <LinkGlyph />}
          <span className="truncate text-sm font-medium text-brand-ink">{task.name}</span>
        </span>
        <span className="block truncate text-xs text-brand-gray">
          {dates ? `${shortDate(dates.start)} – ${shortDate(dates.end)}` : '—'}
        </span>
      </button>

      {days.map((d) => (
        <div key={d} className={`h-11 border-l border-black/5 ${cellTint(d, holidaySet, now)}`} />
      ))}

      {inView && startIdx >= 0 && endIdx >= startIdx && (
        <button
          onClick={onEdit}
          title={`${task.name} — ${shortDate(dates!.start)} to ${shortDate(dates!.end)}${
            crew ? `\n${crew}` : ''
          }${conflicted ? '\nDouble-booked with another job' : ''}`}
          style={{ gridRow: 1, gridColumn: `${startIdx + 2} / ${endIdx + 3}` }}
          className={`z-10 my-2 flex items-center overflow-hidden rounded px-2 text-left text-[11px] font-medium text-white transition-opacity hover:opacity-90 ${
            BAR_TINT[task.status]
          } ${conflicted ? 'ring-2 ring-red-500 ring-offset-1' : ''} ${
            runsEarlier ? 'rounded-l-none' : ''
          } ${runsLater ? 'rounded-r-none' : ''}`}
        >
          <span className="truncate">
            {task.name}
            {crew && <span className="opacity-80"> · {crew}</span>}
          </span>
        </button>
      )}
    </div>
  );
}

const BAR_TINT: Record<ScheduleTaskRow['status'], string> = {
  not_started: 'bg-brand-gray',
  in_progress: 'bg-status-progress',
  complete: 'bg-brand-green',
};

/* --------------------------------------------------------- Conflict strip */

function ConflictStrip({
  conflicts,
}: {
  conflicts: ReturnType<typeof findConflicts>;
}) {
  // One line per person, however many of their bookings clash.
  const byPerson = new Map<string, { name: string; spans: string[] }>();
  for (const c of conflicts) {
    const entry = byPerson.get(c.key) ?? { name: c.name, spans: [] };
    const span = `${shortDate(c.start)} – ${shortDate(c.end)} (${c.a.projectName} / ${c.b.projectName})`;
    if (!entry.spans.includes(span)) entry.spans.push(span);
    byPerson.set(c.key, entry);
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-sm font-semibold text-red-800">
        {byPerson.size === 1 ? '1 double-booking' : `${byPerson.size} double-bookings`}
      </p>
      <ul className="mt-1 space-y-0.5 text-sm text-red-700">
        {[...byPerson.values()].map((p) => (
          <li key={p.name}>
            <strong>{p.name}</strong> — {p.spans.join('; ')}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------------------------------------------- helpers */

function isOff(day: string, holidays: Set<string>): boolean {
  return isWeekend(day) || holidays.has(day);
}

/** Background for a day column: today first, then non-working days. */
function cellTint(day: string, holidays: Set<string>, now: string): string {
  if (day === now) return 'bg-brand-green/10';
  return isOff(day, holidays) ? 'bg-black/[.04]' : '';
}

function clamp(day: string, min: string, max: string): string {
  return day < min ? min : day > max ? max : day;
}

/** "March 2026", or "Mar – Apr 2026" when the range straddles two months. */
function monthLabel(from: string, to: string): string {
  const a = fromDay(from);
  const b = fromDay(to);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return a.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  const short = { month: 'short' } as const;
  return `${a.toLocaleDateString('en-US', short)} – ${b.toLocaleDateString('en-US', { ...short, year: 'numeric' })}`;
}

/** Marks a phase whose start is driven by the one before it. */
function LinkGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className="shrink-0 text-brand-gray"
      aria-label="Follows another phase"
    >
      <path d="M9 15l6-6" />
      <path d="M11 6l1-1a4 4 0 015.7 5.7l-1 1" />
      <path d="M13 18l-1 1a4 4 0 01-5.7-5.7l1-1" />
    </svg>
  );
}
