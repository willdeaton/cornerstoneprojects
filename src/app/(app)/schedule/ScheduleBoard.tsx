'use client';

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { shortDate } from '@/lib/format';
import {
  addDays,
  assigneeBookings,
  computeSchedule,
  conflictedTaskIds,
  crewBudget,
  eachDay,
  findConflicts,
  shiftLabel,
  fromDay,
  isWeekend,
  projectedEnd,
  rangesOverlap,
  today,
  mondayLabel,
  weekAlignedRange,
  weekBands,
  weekStart,
  workedSegments,
  workingDaySpan,
  type ComputedWindow,
} from '@/lib/schedule-math';
import type { ProjectStatus, ScheduleTaskRow } from '@/lib/types';
import { PROJECT_STATUS_LABELS } from '@/lib/types';
import { Modal } from '@/components/Modal';
import { OnHoldBadge } from '@/components/ui';
import { TaskModal, type ProjectOption, type SubOption } from './TaskModal';
import { PublishBar, type PublishedInfo } from './PublishBar';
import type { ScheduleDraft } from './useScheduleDraft';
import { HardFinishControl } from './HardFinishControl';
import { OnHoldControl } from './OnHoldControl';

/** Timeline widths offered by the range switcher, in whole weeks. */
const SPANS = [
  { days: 7, label: 'Week' },
  { days: 14, label: '2 Weeks' },
  { days: 42, label: '6 Weeks' },
] as const;

const DEFAULT_SPAN = 14;

/**
 * A colour per job, cycled down the board.
 *
 * The timeline's problem is that every job looks like the one above it: the same
 * grid, the same grey header, bars tinted by phase status rather than by whose
 * job they are. So each job gets a hue and keeps it — a rule down its left edge,
 * a dot by its name, a wash across its header band and its collapsed bar — and
 * the eye can hold one job across six weeks of columns. Cycled by position, so
 * two jobs next to each other are never the same colour; it identifies nothing,
 * it just separates.
 *
 * Written as whole class strings rather than composed at runtime so Tailwind
 * actually emits them.
 */
interface JobAccent {
  /** The rule down the left edge of the job's header row. */
  stripe: string;
  /** The same rule, softened, down its phase rows. */
  stripeSoft: string;
  /** Label background on the header row — opaque, because it's sticky. */
  head: string;
  /** The dot beside the job's name. */
  mark: string;
  /** The wash across the header row's day cells. */
  band: string;
  /** The collapsed job's single roll-up bar. */
  rollup: string;
}

const JOB_ACCENTS: JobAccent[] = [
  {
    stripe: 'border-l-[#7BA82C]',
    stripeSoft: 'border-l-[#7BA82C]/30',
    head: 'bg-[#eff5e3]',
    mark: 'bg-[#7BA82C]',
    band: 'bg-[#7BA82C]/[.07]',
    rollup: 'bg-[#7BA82C]/40',
  },
  {
    stripe: 'border-l-[#4B7BB5]',
    stripeSoft: 'border-l-[#4B7BB5]/30',
    head: 'bg-[#eaf0f7]',
    mark: 'bg-[#4B7BB5]',
    band: 'bg-[#4B7BB5]/[.07]',
    rollup: 'bg-[#4B7BB5]/40',
  },
  {
    stripe: 'border-l-[#C4714E]',
    stripeSoft: 'border-l-[#C4714E]/30',
    head: 'bg-[#f8ece7]',
    mark: 'bg-[#C4714E]',
    band: 'bg-[#C4714E]/[.07]',
    rollup: 'bg-[#C4714E]/40',
  },
  {
    stripe: 'border-l-[#3C9B94]',
    stripeSoft: 'border-l-[#3C9B94]/30',
    head: 'bg-[#e7f2f1]',
    mark: 'bg-[#3C9B94]',
    band: 'bg-[#3C9B94]/[.07]',
    rollup: 'bg-[#3C9B94]/40',
  },
  {
    stripe: 'border-l-[#8A6BA8]',
    stripeSoft: 'border-l-[#8A6BA8]/30',
    head: 'bg-[#f1edf6]',
    mark: 'bg-[#8A6BA8]',
    band: 'bg-[#8A6BA8]/[.07]',
    rollup: 'bg-[#8A6BA8]/40',
  },
  {
    stripe: 'border-l-[#B08900]',
    stripeSoft: 'border-l-[#B08900]/30',
    head: 'bg-[#f8f2e0]',
    mark: 'bg-[#B08900]',
    band: 'bg-[#B08900]/[.07]',
    rollup: 'bg-[#B08900]/40',
  },
];

function jobAccent(index: number): JobAccent {
  return JOB_ACCENTS[index % JOB_ACCENTS.length];
}

type Editing = { task?: ScheduleTaskRow; projectId?: number } | null;

/** A job as the board lists it — every live job, scheduled or not. */
export interface BoardProject extends ProjectOption {
  status: ProjectStatus;
  /** The address the crew drives to, shown under the job name. */
  site_address?: string | null;
  /** Parked waiting on somebody else — still planned, just not on us. */
  on_hold?: boolean;
  /** What the hold is waiting on. */
  on_hold_reason?: string | null;
  /** When it was parked. */
  on_hold_since?: string | null;
}

/**
 * Where the timeline opens. The week containing today, unless nothing is
 * scheduled in that window — then it jumps to the week the next work starts in,
 * so the board never opens blank while a job sits a month out.
 */
function initialAnchor(tasks: ScheduleTaskRow[], holidays: string[]): string {
  const now = today();
  if (tasks.length === 0) return now;
  const { windows } = computeSchedule(tasks, { holidays: new Set(holidays) });
  const all = [...windows.values()];
  const opening = weekAlignedRange(now, DEFAULT_SPAN);
  if (all.some((w) => rangesOverlap(w.start, w.end, opening.start, opening.end))) {
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
  subs,
  holidays,
  published,
  changeCounts = {},
  canUnpublish = false,
  draft,
  finishedProjects = [],
}: {
  tasks: ScheduleTaskRow[];
  /**
   * Every live job, including ones with nothing scheduled yet, plus the finished
   * ones whose work falls in the history that was loaded.
   */
  projects: BoardProject[];
  /** The subcontractor catalog, for phases that get contracted out. */
  subs: SubOption[];
  holidays: string[];
  /** Publish state per job id, for jobs that have been published. */
  published: Record<number, PublishedInfo>;
  /** Logged schedule changes per job id, published or not. */
  changeCounts?: Record<number, number>;
  /** Admins can undo a publish. */
  canUnpublish?: boolean;
  /**
   * The draft phases are edited into. Saving it is what writes them; the crew
   * only ever hears about them when the schedule is published.
   */
  draft: ScheduleDraft;
  /**
   * Jobs that are finished. Their phases are drawn on the weeks they ran, out of
   * every count of work still to plan or staff, and only listed at all on a
   * range their work actually touches. They stay editable — a date or a duration
   * that turns out to have been recorded wrong has to be fixable without
   * reopening the job — behind a confirmation on every change.
   */
  finishedProjects?: number[];
}) {
  const finished = useMemo(() => new Set(finishedProjects), [finishedProjects]);
  // Work still being planned. Finished jobs are drawn but never counted: their
  // crew days aren't outstanding, and a clash between two jobs that are both
  // over is nothing anybody can act on.
  const liveTasks = useMemo(() => tasks.filter((t) => !finished.has(t.project_id)), [tasks, finished]);

  const [spanDays, setSpanDays] = useState<number>(DEFAULT_SPAN);
  const [anchor, setAnchor] = useState<string>(() => initialAnchor(liveTasks, holidays));
  const [projectFilter, setProjectFilter] = useState<number | 'all'>('all');
  /** 'short' narrows the board to phases the crew week hasn't filled yet. */
  const [staffing, setStaffing] = useState<'all' | 'short'>('all');
  const [editing, setEditing] = useState<Editing>(null);
  /**
   * An edit to a finished job, held back until it's agreed to. The phases of a
   * job that is over are the record of what was worked and probably already
   * billed, so the editor doesn't open on one until somebody has said yes.
   */
  const [confirming, setConfirming] = useState<{ edit: Editing; jobName: string; what: string } | null>(
    null
  );
  // Per-job expand/collapse, only for jobs the user has actually clicked. Jobs
  // they haven't touched follow the default below, which tracks the visible
  // range — so paging to a quiet week doesn't leave every row shut.
  const [openState, setOpenState] = useState<Record<number, boolean>>({});

  const calendar = useMemo(() => ({ holidays: new Set(holidays) }), [holidays]);
  const holidaySet = calendar.holidays;

  // Real dates for every phase, derived from the dependency chains. Computed
  // here rather than on the server so the same solver drives the phase editor's
  // live preview — one set of rules, one place.
  const { windows } = useMemo(() => computeSchedule(tasks, calendar), [tasks, calendar]);

  // Conflicts compare the days AND hours people actually work, so someone splitting a
  // week between two jobs (Mon/Wed here, Tue there) isn't flagged — only days
  // genuinely booked twice are.
  const conflicts = useMemo(
    () => findConflicts(assigneeBookings(liveTasks, windows, calendar)),
    [liveTasks, windows, calendar]
  );
  const conflictedTasks = useMemo(() => conflictedTaskIds(conflicts), [conflicts]);

  // Every view is a whole number of weeks starting on a Monday: the crew reads
  // the schedule a week at a time, and a 2- or 6-week timeline that opened
  // mid-week would put the same weekday in a different column every time.
  const range = useMemo(() => weekAlignedRange(anchor, spanDays), [anchor, spanDays]);
  const days = useMemo(() => eachDay(range.start, range.end), [range]);
  const bands = useMemo(() => weekBands(days), [days]);
  const rangeStart = range.start;
  const rangeEnd = range.end;
  const now = today();

  /** Crew asked for vs crew booked, per phase — what the timeline reports on. */
  const budgets = useMemo(() => {
    const out = new Map<number, ReturnType<typeof crewBudget>>();
    for (const t of tasks) out.set(t.id, crewBudget(t, windows.get(t.id), calendar));
    return out;
  }, [tasks, windows, calendar]);

  const visible = useMemo(
    () =>
      tasks.filter((t) => {
        if (projectFilter !== 'all' && t.project_id !== projectFilter) return false;
        if (staffing === 'short') {
          // Crew days left on a job that is over aren't days anybody can book.
          if (finished.has(t.project_id)) return false;
          if ((budgets.get(t.id)?.remaining ?? 0) === 0) return false;
        }
        return true;
      }),
    [tasks, projectFilter, staffing, budgets, finished]
  );

  /**
   * One group per job — every live job, not just the ones with phases. A job
   * with nothing scheduled still needs to be on the board: that it hasn't been
   * planned yet is exactly what a manager is looking for.
   */
  const groups = useMemo(() => {
    const byProject = new Map<number, ScheduleTaskRow[]>();
    for (const t of visible) {
      const list = byProject.get(t.project_id);
      if (list) list.push(t);
      else byProject.set(t.project_id, [t]);
    }
    // With a filter on, only jobs that match it are worth a row; with no
    // filters, every live job appears.
    const filtering = projectFilter !== 'all' || staffing !== 'all';

    return projects
      .filter((p) => !filtering || byProject.has(p.id))
      .map((p) => {
        const list = byProject.get(p.id) ?? [];
        const sorted = [...list].sort((a, b) => {
          const aw = windows.get(a.id)?.start ?? a.start_date;
          const bw = windows.get(b.id)?.start ?? b.start_date;
          return aw < bw ? -1 : aw > bw ? 1 : a.position - b.position;
        });
        const end = projectedEnd(
          sorted.map((t) => t.id),
          windows
        );
        const start = sorted[0] ? windows.get(sorted[0].id)?.start ?? null : null;
        return {
          projectId: p.id,
          projectName: p.name,
          customer: p.customer,
          address: p.site_address ?? null,
          status: p.status,
          onHold: !!p.on_hold,
          onHoldReason: p.on_hold_reason ?? null,
          onHoldSince: p.on_hold_since ?? null,
          dueDate: p.due_date,
          hardFinish: p.hard_finish_date ?? null,
          projected: end,
          start,
          // A finished job is never late here. "Past due date" is a warning about
          // a plan, and this plan is over — the job's own page is where a finish
          // that missed its date is worth reading about.
          slipping: !finished.has(p.id) && !!(end && p.due_date && end > p.due_date),
          missingHardFinish:
            !finished.has(p.id) && !!(end && p.hard_finish_date && end > p.hard_finish_date),
          // Whether any of its work lands in the window on screen — the board
          // opens these expanded and leaves the rest folded away.
          inRange: sorted.some((t) => {
            const w = windows.get(t.id);
            return !!w && rangesOverlap(w.start, w.end, rangeStart, rangeEnd);
          }),
          tasks: sorted,
        };
      })
      // A finished job is history, so it only earns a row on the ranges its work
      // actually covers — otherwise every job ever done would sit on this week.
      .filter((g) => !finished.has(g.projectId) || g.inRange)
      .sort((a, b) => {
        // Jobs with work planned come first, in the order that work starts;
        // unscheduled jobs sit together at the bottom, alphabetically.
        if (a.start && b.start) return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
        if (a.start) return -1;
        if (b.start) return 1;
        return a.projectName.localeCompare(b.projectName);
      });
  }, [projects, visible, windows, projectFilter, staffing, rangeStart, rangeEnd, finished]);

  const unplanned = groups.filter((g) => g.tasks.length === 0).length;
  // Rows that are only on screen because their work ran in this range.
  const history = groups.filter((g) => finished.has(g.projectId)).length;
  // Jobs parked waiting on somebody else. Still planned, still counted — the
  // point of the number is that a board with three of them says so.
  const held = groups.filter((g) => g.onHold && !finished.has(g.projectId)).length;

  // Just the version numbers, which is all the phase editor needs to decide
  // whether a change requires a reason.
  const publishedVersionMap = useMemo(() => {
    const out: Record<number, number> = {};
    for (const [id, info] of Object.entries(published)) out[Number(id)] = info.version;
    return out;
  }, [published]);

  // Crew-days still to be booked across everything on the board — the one
  // number that says whether the plan has been staffed yet.
  const shortfall = useMemo(
    () =>
      visible
        .filter((t) => !finished.has(t.project_id))
        .reduce((n, t) => n + (budgets.get(t.id)?.remaining ?? 0), 0),
    [visible, budgets, finished]
  );

  function isOpen(g: { projectId: number; inRange: boolean }): boolean {
    return openState[g.projectId] ?? g.inRange;
  }

  /**
   * Open the phase editor — after saying so out loud when the job is over.
   *
   * A finished job's phases are editable here because a plan that was recorded
   * wrong has to be correctable: a phase that actually ran three days longer,
   * or a duration typed against the wrong phase, is a mistake in the record and
   * reopening the whole job to fix it is worse. But they are the record of work
   * already done and probably already billed, so nothing about one changes
   * before somebody has agreed to change it, and there is no unlocked mode to
   * forget you left on.
   */
  function openEditor(edit: Editing, over: { jobName: string; what: string } | null) {
    if (over) setConfirming({ edit, ...over });
    else setEditing(edit);
  }

  function setAllOpen(open: boolean) {
    setOpenState(Object.fromEntries(groups.map((g) => [g.projectId, open])));
  }

  // The job name leads its block, so the label column is wide enough to read
  // one; then one equal column per day.
  const gridTemplate = `minmax(232px, 260px) repeat(${days.length}, minmax(26px, 1fr))`;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-black/10">
          {/* One week per press, whatever width is on screen. A 6-week view that
              paged six weeks at a time skipped everything between: the arrows
              slide the window, they don't jump it. */}
          <button
            className="px-3 py-2 text-sm font-medium text-brand-gray hover:bg-black/5"
            onClick={() => setAnchor(addDays(rangeStart, -7))}
            aria-label="Back one week"
            title="Back one week"
          >
            ‹
          </button>
          <button
            className="border-x border-black/10 px-3 py-2 text-sm font-medium text-brand-ink hover:bg-black/5"
            onClick={() => setAnchor(weekStart(today()))}
            title="Jump back to the week containing today"
          >
            This Week
          </button>
          <button
            className="px-3 py-2 text-sm font-medium text-brand-gray hover:bg-black/5"
            onClick={() => setAnchor(addDays(rangeStart, 7))}
            aria-label="Forward one week"
            title="Forward one week"
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
                  ? 'bg-brand-green font-semibold text-brand-ink'
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
              {finished.has(p.id) ? `${p.name} · finished` : p.name}
            </option>
          ))}
        </select>

        <select
          className="input w-auto"
          value={staffing}
          onChange={(e) => setStaffing(e.target.value as 'all' | 'short')}
        >
          <option value="all">All phases</option>
          <option value="short">Still needs crew</option>
        </select>

        <div className="ml-auto flex gap-2">
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
          <p className="font-semibold text-brand-ink">No jobs to show</p>
          <p className="mt-1 text-sm text-brand-gray">
            {projects.length === 0
              ? 'Add a project and it will appear here, ready to schedule.'
              : 'No jobs match these filters.'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-gray">
            <span>
              {groups.length} {groups.length === 1 ? 'job' : 'jobs'}
              {history > 0 && ` · ${history} finished`}
              {held > 0 && (
                <span className="font-medium text-amber-800"> · {held} on hold</span>
              )}
              {unplanned > 0 && ` · ${unplanned} with nothing scheduled yet`}
              {shortfall > 0 && (
                <span className="font-medium text-amber-700">
                  {' '}
                  · {shortfall} crew {shortfall === 1 ? 'day' : 'days'} still to be booked in the
                  Crew Week
                </span>
              )}
            </span>
            <button
              className="font-medium text-brand-green-dark hover:underline"
              onClick={() => setAllOpen(true)}
            >
              Expand all
            </button>
            <button
              className="font-medium text-brand-green-dark hover:underline"
              onClick={() => setAllOpen(false)}
            >
              Collapse all
            </button>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <div className="min-w-[900px]">
                {/* Week band: each week's Monday, held until the next week starts. */}
                <div
                  className="grid border-b border-black/10 bg-black/[.04]"
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  <div className="sticky left-0 z-20 bg-[#f4f4f4] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-brand-gray">
                    {monthLabel(rangeStart, rangeEnd)}
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

                {/* Date header */}
                <div
                  className="grid border-b border-black/10 bg-black/[.02]"
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  <div className="sticky left-0 z-20 bg-[#fafafa] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">
                    Job / Phase
                  </div>
                  {days.map((d) => (
                    <div
                      key={d}
                      className={`py-2 text-center text-[11px] leading-tight ${weekEdge(d)} ${
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

                {groups.map((g, gi) => {
                  const open = isOpen(g);
                  // A job that is over is history: on screen for the weeks it
                  // ran, out of every count, and editable only behind a
                  // confirmation — see openEditor.
                  const over = finished.has(g.projectId);
                  const accent = jobAccent(gi);
                  // What a click on one of this job's phases has to agree to
                  // first, or null while the job is still a live plan.
                  const gate = over ? { jobName: g.projectName } : null;
                  return (
                    <div
                      key={g.projectId}
                      // Each job is its own block with a real gutter above it:
                      // the thing this view is read for is "which job is this",
                      // and a hairline between two grids never answered that.
                      className={`relative ${gi > 0 ? 'border-t-[6px] border-surface-sunken' : ''}`}
                    >
                      {/* Job header row — click the name row to fold the job away. */}
                      <div
                        className="grid"
                        style={{ gridTemplateColumns: gridTemplate }}
                      >
                        <div
                          style={{ gridRow: 1, gridColumn: 1 }}
                          className={`sticky left-0 z-20 border-l-4 py-2 pl-3 pr-4 ${accent.stripe} ${
                            over ? 'bg-[#f2f2f1]' : g.onHold ? 'bg-[#faf3e4]' : accent.head
                          }`}
                        >
                          <div className="flex items-start gap-1.5">
                            <button
                              onClick={() =>
                                setOpenState((prev) => ({ ...prev, [g.projectId]: !open }))
                              }
                              className="mt-0.5 shrink-0 text-brand-gray hover:text-brand-ink"
                              aria-expanded={open}
                              aria-label={open ? `Collapse ${g.projectName}` : `Expand ${g.projectName}`}
                              title={open ? 'Collapse this job' : 'Expand this job'}
                            >
                              <Chevron open={open} />
                            </button>
                            <div className="min-w-0">
                              <Link
                                href={`/projects/${g.projectId}`}
                                className="flex items-center gap-1.5 text-[15px] font-bold leading-tight text-brand-ink hover:text-brand-green-dark"
                              >
                                {/* The job's own colour, repeated down every row
                                    it owns — the thread that ties a bar on the
                                    right to a name on the left. */}
                                <span className={`h-2 w-2 shrink-0 rounded-full ${accent.mark}`} />
                                <span className="truncate">{g.projectName}</span>
                              </Link>
                              <p className="truncate text-xs font-medium text-brand-gray">{g.customer}</p>
                              <p className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className={`badge ${STATUS_BADGE[g.status]}`}>
                                  {PROJECT_STATUS_LABELS[g.status]}
                                </span>
                                {g.onHold && !over && (
                                  <OnHoldBadge reason={g.onHoldReason} since={g.onHoldSince} />
                                )}
                                <span className="text-[11px] text-brand-gray">
                                  {g.tasks.length === 0
                                    ? 'no phases yet'
                                    : `${g.tasks.length} ${g.tasks.length === 1 ? 'phase' : 'phases'}`}
                                </span>
                              </p>
                              {g.onHold && g.onHoldReason && !over && (
                                <p
                                  className="mt-0.5 truncate text-[11px] font-medium text-amber-800"
                                  title={`On hold — ${g.onHoldReason}${
                                    g.onHoldSince ? ` · since ${shortDate(g.onHoldSince)}` : ''
                                  }`}
                                >
                                  {g.onHoldReason}
                                </p>
                              )}
                              {g.address && (
                                <a
                                  href={mapsUrl(g.address)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-0.5 block truncate text-[11px] text-brand-green-dark hover:underline"
                                  title={`Directions to ${g.address}`}
                                >
                                  {g.address}
                                </a>
                              )}
                              {g.tasks.length > 0 && (
                                <p
                                  className={`mt-0.5 text-xs font-medium ${
                                    g.missingHardFinish
                                      ? 'text-red-700'
                                      : g.slipping
                                        ? 'text-amber-700'
                                        : 'text-brand-gray'
                                  }`}
                                  title={
                                    g.missingHardFinish
                                      ? `Projected finish is after the ${shortDate(g.hardFinish)} hard finish date`
                                      : g.slipping
                                        ? `Projected finish is after the ${shortDate(g.dueDate)} due date`
                                        : undefined
                                  }
                                >
                                  Ends {shortDate(g.projected)}
                                  {g.missingHardFinish
                                    ? ' · past hard finish'
                                    : g.slipping
                                      ? ' · past due date'
                                      : ''}
                                </p>
                              )}
                              {over ? (
                                <p
                                  className="text-[11px] font-medium text-brand-gray"
                                  title="Marked complete. Its dates are kept so a week that has been worked reads true — and can still be corrected, with every change confirmed first."
                                >
                                  Finished job · shown for the weeks it ran · edits are confirmed
                                </p>
                              ) : (
                                <>
                                  {/* Two small text controls side by side, so
                                      they wrap as a pair instead of butting
                                      into each other on a narrow label. */}
                                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <HardFinishControl
                                      projectId={g.projectId}
                                      projectName={g.projectName}
                                      hardFinishDate={g.hardFinish}
                                      projectedEnd={g.projected}
                                    />
                                    <OnHoldControl
                                      projectId={g.projectId}
                                      projectName={g.projectName}
                                      onHold={g.onHold}
                                      reason={g.onHoldReason}
                                      since={g.onHoldSince}
                                    />
                                  </span>
                                  <PublishBar
                                    projectId={g.projectId}
                                    projectName={g.projectName}
                                    published={published[g.projectId] ?? null}
                                    changeCount={changeCounts[g.projectId] ?? 0}
                                    canUnpublish={canUnpublish}
                                  />
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        {days.map((d, i) => (
                          <div
                            key={d}
                            style={{ gridRow: 1, gridColumn: i + 2 }}
                            // The job's band runs the full width of the view, so
                            // the eye can follow one job's row across six weeks
                            // without counting rules.
                            className={`min-h-[24px] ${weekEdge(d)} ${bandTint(
                              d,
                              holidaySet,
                              now,
                              over ? 'bg-black/[.03]' : g.onHold ? 'bg-amber-500/[.07]' : accent.band
                            )}`}
                          />
                        ))}
                        {/* Folded away, the job still shows the stretch its work
                            covers — collapsing hides the phases, not the job. */}
                        {!open && (
                          <RollupBar
                            start={g.start}
                            end={g.projected}
                            days={days}
                            rangeStart={rangeStart}
                            rangeEnd={rangeEnd}
                            phases={g.tasks.length}
                            tint={accent.rollup}
                          />
                        )}
                      </div>

                      {/* One row per phase, once the job is expanded */}
                      {open &&
                        (g.tasks.length === 0 ? (
                          <div className={`border-l-4 px-4 py-3 pl-9 ${accent.stripeSoft}`}>
                            <p className="text-sm text-brand-gray">
                              Nothing scheduled on this job yet.{' '}
                              <button
                                className="font-medium text-brand-green-dark hover:underline"
                                onClick={() =>
                                  openEditor(
                                    { projectId: g.projectId },
                                    gate ? { ...gate, what: 'Adding a phase' } : null
                                  )
                                }
                              >
                                Schedule its first phase
                              </button>
                              .
                            </p>
                          </div>
                        ) : (
                          g.tasks.map((t) => (
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
                              onEdit={() =>
                                openEditor(
                                  { task: t },
                                  gate ? { ...gate, what: `Editing \u201c${t.name}\u201d` } : null
                                )
                              }
                              published={!!published[t.project_id]}
                              stripe={accent.stripeSoft}
                              finishedJob={over}
                            />
                          ))
                        ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      <p className="text-xs text-brand-gray">
        Every live job is listed as its own block, with its own colour down the left edge and across
        its band — expand one to see its phases, or whether it has any yet. A phase here is the
        work: how long it runs and how many people it takes. Who those people are, and what time
        they start, is settled a week at a time in the Crew Week. The arrows move one week at a
        time whatever width is on screen; each view runs in whole weeks from Monday, with every
        week&apos;s Monday held above its days, and weekends and non-working days are shaded and
        never count toward a phase&apos;s duration. A phase marked &ldquo;starts after&rdquo;
        another moves automatically when the one before it slips, and moving any phase&apos;s dates
        asks for a reason that&apos;s kept with the job. A job waiting on somebody else can be put
        <span className="whitespace-nowrap"> on hold</span> — it keeps its dates and its place here,
        badged with what it&apos;s waiting on. Page back and finished jobs appear on the weeks they
        ran, drawn back and out of every count of what is still to plan; they can still be
        corrected, and every change to one is confirmed first.
      </p>

      {/* The warning before a finished job is touched. A real dialog rather than
          a browser confirm: it has to say which job, what is about to change and
          why that matters, and be dismissable without changing anything. */}
      {confirming && (
        <Modal open onClose={() => setConfirming(null)} title="This job is already finished">
          <div className="space-y-4">
            <p className="text-sm text-brand-ink">
              <span className="font-semibold">{confirming.jobName}</span> is marked complete.{' '}
              {confirming.what} changes the record of work that has already been done — and
              probably already billed.
            </p>
            <p className="text-sm text-brand-gray">
              Go ahead if the record is wrong. The change is logged against the job with the reason
              you give, the same as any other change to a schedule.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setEditing(confirming.edit);
                  setConfirming(null);
                }}
              >
                Edit Anyway
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editing && (
        <TaskModal
          task={editing.task}
          initialProjectId={editing.projectId}
          allTasks={tasks}
          projects={projects}
          subs={subs}
          holidays={holidays}
          publishedVersions={publishedVersionMap}
          draft={draft}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/**
 * The whole job as one muted bar, drawn on its header row while it's collapsed.
 * Deliberately a single span rather than the worked stretches: it answers "when
 * is this job on site" at a glance, and expanding the job gives the real shape.
 */
function RollupBar({
  start,
  end,
  days,
  rangeStart,
  rangeEnd,
  phases,
  tint,
}: {
  start: string | null;
  end: string | null;
  days: string[];
  rangeStart: string;
  rangeEnd: string;
  phases: number;
  /** The job's own colour, so a folded job still reads as that job. */
  tint: string;
}) {
  if (!start || !end || start > rangeEnd || end < rangeStart) return null;
  const from = clamp(start, rangeStart, rangeEnd);
  const to = clamp(end, rangeStart, rangeEnd);
  const startIdx = days.indexOf(from);
  const endIdx = days.indexOf(to);
  if (startIdx < 0 || endIdx < startIdx) return null;

  return (
    <div
      style={{ gridRow: 1, gridColumn: `${startIdx + 2} / ${endIdx + 3}` }}
      className={`z-10 my-2 flex h-6 items-center self-center overflow-hidden rounded px-2 text-[11px] font-medium text-brand-ink ${tint}`}
      title={`${shortDate(start)} – ${shortDate(end)} · ${phases} ${phases === 1 ? 'phase' : 'phases'}`}
    >
      <span className="truncate">
        {phases} {phases === 1 ? 'phase' : 'phases'} · {shortDate(start)} – {shortDate(end)}
      </span>
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
  published,
  stripe,
  finishedJob = false,
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
  published: boolean;
  /** The rule down the left edge, in the job's colour. */
  stripe: string;
  /**
   * The job is finished: the row is the record of what ran rather than a plan.
   * Drawn back a shade and still editable — a record that turns out to be wrong
   * has to be fixable — with the confirmation handled by whoever owns `onEdit`.
   */
  finishedJob?: boolean;
  onEdit: () => void;
}) {
  const budget = useMemo(
    () => crewBudget(task, dates, { holidays: holidaySet }),
    [task, dates, holidaySet]
  );
  const workingDays = dates ? workingDaySpan(dates.start, dates.end, { holidays: holidaySet }) : 0;

  // One bar per unbroken run of working days, clipped to the visible range. That
  // gap over a weekend is the point: a phase that spans two weeks reads as two
  // stretches instead of one bar that looks like Saturday work.
  const segments = useMemo(() => {
    if (!dates) return [];
    return workedSegments(dates.start, dates.end, { holidays: holidaySet })
      .filter((s) => s.start <= rangeEnd && s.end >= rangeStart)
      .map((s) => {
        const from = clamp(s.start, rangeStart, rangeEnd);
        const to = clamp(s.end, rangeStart, rangeEnd);
        return {
          key: s.start,
          startIdx: days.indexOf(from),
          endIdx: days.indexOf(to),
          clippedLeft: s.start < rangeStart,
          clippedRight: s.end > rangeEnd,
        };
      })
      .filter((s) => s.startIdx >= 0 && s.endIdx >= s.startIdx);
  }, [dates, holidaySet, days, rangeStart, rangeEnd]);

  // What the phase asks for, and how much of it the crew week has covered. A
  // subcontracted phase leads with the sub — that IS the answer to "who's on
  // this" — and only mentions our own crew when some are going along.
  const subName = task.subcontractor_name;
  const ownCrew = `${budget.needed} ${budget.needed === 1 ? 'person' : 'people'} × ${workingDays} ${
    workingDays === 1 ? 'day' : 'days'
  }`;
  const crewNote = subName
    ? budget.capacity === 0
      ? subName
      : `${subName} + ${ownCrew}`
    : ownCrew;
  // "3 crew days to book" is a job of work; on a job that is over it's just how
  // the week was staffed, so the finished row reports the count and stops there.
  const staffedNote =
    budget.capacity === 0
      ? ''
      : budget.remaining === 0
        ? 'fully staffed'
        : finishedJob
          ? `${budget.remaining} crew ${budget.remaining === 1 ? 'day' : 'days'} never booked`
          : `${budget.remaining} crew ${budget.remaining === 1 ? 'day' : 'days'} to book`;

  const tooltip = `${task.name} — ${dates ? `${shortDate(dates.start)} to ${shortDate(dates.end)}` : 'unscheduled'}${
    subName ? `\nSubcontracted to ${subName}` : ''
  }${
    budget.capacity > 0
      ? `\n${subName ? 'Our crew: ' : 'Needs '}${ownCrew} = ${budget.capacity} crew ${
          budget.capacity === 1 ? 'day' : 'days'
        }\n${budget.filled} booked in the Crew Week${staffedNote ? ` · ${staffedNote}` : ''}`
      : ''
  }${task.site_address ? `\n${task.site_address}` : ''}${
    conflicted ? '\nSomeone on this phase is double-booked' : ''
  }${published ? '\nPublished — changes need a reason' : ''}${
    finishedJob
      ? '\nFinished job — the record of the weeks it ran. Editable, with the change confirmed first.'
      : ''
  }`;

  return (
    <div className="grid" style={{ gridTemplateColumns: gridTemplate }}>
      {/* Everything in this row is pinned to grid row 1 on purpose: the bars are
          explicitly placed, and auto-placed cells would be bumped into a second
          row wherever a bar already occupies a column. */}
      <Cell
        onEdit={onEdit}
        style={{ gridRow: 1, gridColumn: 1 }}
        title={tooltip}
        // The job's rule carries on down its phases, a shade lighter, so a row
        // this far from its header still visibly belongs to it.
        className={`sticky left-0 z-20 border-l-4 py-2 pl-8 pr-4 text-left ${stripe} ${
          finishedJob ? 'bg-[#fafafa] text-brand-gray hover:bg-black/[.04]' : 'bg-white hover:bg-black/[.03]'
        }`}
      >
        <span className="flex items-center gap-1.5">
          {dates?.driven && <LinkGlyph />}
          <span className="truncate text-sm font-medium text-brand-ink">{task.name}</span>
        </span>
        <span className="block truncate text-xs text-brand-gray">
          {dates ? `${shortDate(dates.start)} – ${shortDate(dates.end)}` : '—'}
        </span>
        <span className="block truncate text-[11px] font-medium text-brand-ink">
          {subName && <SubGlyph />}
          {crewNote}
        </span>
        {staffedNote && (
          <span
            className={`block truncate text-[11px] font-medium ${
              budget.remaining === 0 ? 'text-brand-green-dark' : 'text-amber-700'
            }`}
          >
            {budget.filled}/{budget.capacity} booked · {staffedNote}
          </span>
        )}
      </Cell>

      {days.map((d, i) => (
        <div
          key={d}
          style={{ gridRow: 1, gridColumn: i + 2 }}
          className={`h-11 ${weekEdge(d)} ${cellTint(d, holidaySet, now)}`}
        />
      ))}

      {segments.map((s, i) => (
        <Cell
          key={s.key}
          onEdit={onEdit}
          title={tooltip}
          style={{ gridRow: 1, gridColumn: `${s.startIdx + 2} / ${s.endIdx + 3}` }}
          className={`z-10 my-2 flex items-center overflow-hidden rounded px-2 text-left text-[11px] font-medium text-white ${
            BAR_TINT[task.status]
          } ${
            finishedJob ? 'opacity-60 transition-opacity hover:opacity-80' : 'transition-opacity hover:opacity-90'
          } ${
            conflicted ? 'ring-2 ring-red-500 ring-offset-1' : ''
          } ${s.clippedLeft ? 'rounded-l-none' : ''} ${s.clippedRight ? 'rounded-r-none' : ''}`}
        >
          {/* Only the first visible stretch carries the label; the rest are the
              continuation of the same phase and stay clean. */}
          {i === 0 && (
            <span className="truncate">
              {task.name}
              <span className="opacity-80"> · {crewNote}</span>
              {budget.remaining > 0 && !finishedJob && (
                <span className="opacity-80"> · {budget.remaining} to book</span>
              )}
            </span>
          )}
        </Cell>
      ))}
    </div>
  );
}

/**
 * A phase row's label or bar — a button on to its editor.
 *
 * Every phase is one, including a finished job's: its dates are a record rather
 * than a plan, but a record that turns out to be wrong has to be fixable, so the
 * row opens the same editor behind a confirmation instead of being dead to the
 * touch.
 */
function Cell({
  onEdit,
  children,
  ...rest
}: {
  onEdit: () => void;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  title?: string;
}) {
  return (
    <button onClick={onEdit} {...rest}>
      {children}
    </button>
  );
}

const BAR_TINT: Record<ScheduleTaskRow['status'], string> = {
  not_started: 'bg-brand-gray',
  in_progress: 'bg-status-progress',
  complete: 'bg-brand-green',
};

const STATUS_BADGE: Record<ProjectStatus, string> = {
  not_started: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-amber-100 text-amber-800',
  completed: 'bg-brand-green/20 text-brand-green-dark',
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
    // The hours are the reason it's a clash rather than a split day, so they
    // belong on the line: "all day / all day" is a different fix from "8–12 /
    // 10–2", which somebody can settle by moving one shift an hour.
    const span = `${shortDate(c.start)} – ${shortDate(c.end)} (${c.a.projectName} ${shiftLabel(
      c.a
    )} / ${c.b.projectName} ${shiftLabel(c.b)})`;
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

/**
 * Background for a day cell on a JOB's header band. Today and the non-working
 * days still win — they're facts about the calendar, not decoration — and
 * everything else takes the job's own wash, so one job's band reads as one
 * stripe across the whole view.
 *
 * One class rather than two stacked backgrounds on purpose: two `bg-` utilities
 * on the same element resolve by stylesheet order, not by the order they're
 * written, so which one won would be luck.
 */
function bandTint(day: string, holidays: Set<string>, now: string, wash: string): string {
  if (day === now) return 'bg-brand-green/20';
  if (isOff(day, holidays)) return 'bg-black/[.07]';
  return wash;
}

/** A firmer rule where a new week starts, so week boundaries read at a glance. */
function weekEdge(day: string): string {
  return fromDay(day).getDay() === 1 ? 'border-l border-black/20' : 'border-l border-black/5';
}

function clamp(day: string, min: string, max: string): string {
  return day < min ? min : day > max ? max : day;
}

/** A tappable directions link for an address typed by hand. */
function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
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

/** Expand/collapse arrow for a job row. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? 'rotate-90' : ''}`}
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** Marks a phase a subcontractor is carrying rather than our own crew. */
function SubGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mr-0.5 inline-block shrink-0 align-[-1px] text-brand-gray"
      aria-label="Subcontracted"
    >
      <path d="M3 7h18v13H3z" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
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
