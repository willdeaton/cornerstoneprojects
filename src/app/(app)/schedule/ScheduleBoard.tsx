'use client';

import { useMemo, useState } from 'react';
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
import { TaskModal, type ProjectOption, type SubOption } from './TaskModal';
import { PublishBar, type PublishedInfo } from './PublishBar';
import type { ScheduleDraft } from './useScheduleDraft';
import { HardFinishControl } from './HardFinishControl';

/** Timeline widths offered by the range switcher, in whole weeks. */
const SPANS = [
  { days: 7, label: 'Week' },
  { days: 14, label: '2 Weeks' },
  { days: 42, label: '6 Weeks' },
] as const;

const DEFAULT_SPAN = 14;

type Editing = { task?: ScheduleTaskRow; projectId?: number } | null;

/** A job as the board lists it — every live job, scheduled or not. */
export interface BoardProject extends ProjectOption {
  status: ProjectStatus;
  /** The address the crew drives to, shown under the job name. */
  site_address?: string | null;
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
}: {
  tasks: ScheduleTaskRow[];
  /** Every live job, including ones with nothing scheduled yet. */
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
}) {
  const [spanDays, setSpanDays] = useState<number>(DEFAULT_SPAN);
  const [anchor, setAnchor] = useState<string>(() => initialAnchor(tasks, holidays));
  const [projectFilter, setProjectFilter] = useState<number | 'all'>('all');
  /** 'short' narrows the board to phases the crew week hasn't filled yet. */
  const [staffing, setStaffing] = useState<'all' | 'short'>('all');
  const [editing, setEditing] = useState<Editing>(null);
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
    () => findConflicts(assigneeBookings(tasks, windows, calendar)),
    [tasks, windows, calendar]
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
        if (staffing === 'short' && (budgets.get(t.id)?.remaining ?? 0) === 0) return false;
        return true;
      }),
    [tasks, projectFilter, staffing, budgets]
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
          dueDate: p.due_date,
          hardFinish: p.hard_finish_date ?? null,
          projected: end,
          start,
          slipping: !!(end && p.due_date && end > p.due_date),
          missingHardFinish: !!(end && p.hard_finish_date && end > p.hard_finish_date),
          // Whether any of its work lands in the window on screen — the board
          // opens these expanded and leaves the rest folded away.
          inRange: sorted.some((t) => {
            const w = windows.get(t.id);
            return !!w && rangesOverlap(w.start, w.end, rangeStart, rangeEnd);
          }),
          tasks: sorted,
        };
      })
      .sort((a, b) => {
        // Jobs with work planned come first, in the order that work starts;
        // unscheduled jobs sit together at the bottom, alphabetically.
        if (a.start && b.start) return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
        if (a.start) return -1;
        if (b.start) return 1;
        return a.projectName.localeCompare(b.projectName);
      });
  }, [projects, visible, windows, projectFilter, staffing, rangeStart, rangeEnd]);

  const unplanned = groups.filter((g) => g.tasks.length === 0).length;

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
    () => visible.reduce((n, t) => n + (budgets.get(t.id)?.remaining ?? 0), 0),
    [visible, budgets]
  );

  function isOpen(g: { projectId: number; inRange: boolean }): boolean {
    return openState[g.projectId] ?? g.inRange;
  }

  function setAllOpen(open: boolean) {
    setOpenState(Object.fromEntries(groups.map((g) => [g.projectId, open])));
  }

  // 220px of labels, then one equal column per day.
  const gridTemplate = `minmax(200px, 220px) repeat(${days.length}, minmax(26px, 1fr))`;
  const weeks = Math.max(1, Math.round(days.length / 7));

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-black/10">
          <button
            className="px-3 py-2 text-sm font-medium text-brand-gray hover:bg-black/5"
            onClick={() => setAnchor(addDays(rangeStart, -7 * weeks))}
            aria-label="Earlier"
          >
            ‹
          </button>
          <button
            className="border-x border-black/10 px-3 py-2 text-sm font-medium text-brand-ink hover:bg-black/5"
            onClick={() => setAnchor(weekStart(today()))}
          >
            This Week
          </button>
          <button
            className="px-3 py-2 text-sm font-medium text-brand-gray hover:bg-black/5"
            onClick={() => setAnchor(addDays(rangeStart, 7 * weeks))}
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
              {p.name}
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
              <div className="min-w-[820px]">
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

                {groups.map((g) => {
                  const open = isOpen(g);
                  return (
                    <div key={g.projectId} className="border-b border-black/10 last:border-0">
                      {/* Job header row — click the name row to fold the job away. */}
                      <div
                        className="grid bg-black/[.02]"
                        style={{ gridTemplateColumns: gridTemplate }}
                      >
                        <div
                          style={{ gridRow: 1, gridColumn: 1 }}
                          className="sticky left-0 z-20 bg-[#fafafa] px-4 py-2"
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
                                className="block truncate text-sm font-semibold text-brand-ink hover:text-brand-green-dark"
                              >
                                {g.projectName}
                              </Link>
                              <p className="truncate text-xs text-brand-gray">{g.customer}</p>
                              <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                <span className={`badge ${STATUS_BADGE[g.status]}`}>
                                  {PROJECT_STATUS_LABELS[g.status]}
                                </span>
                                <span className="text-[11px] text-brand-gray">
                                  {g.tasks.length === 0
                                    ? 'no phases yet'
                                    : `${g.tasks.length} ${g.tasks.length === 1 ? 'phase' : 'phases'}`}
                                </span>
                              </p>
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
                              <HardFinishControl
                                projectId={g.projectId}
                                projectName={g.projectName}
                                hardFinishDate={g.hardFinish}
                                projectedEnd={g.projected}
                              />
                              <PublishBar
                                projectId={g.projectId}
                                projectName={g.projectName}
                                published={published[g.projectId] ?? null}
                                changeCount={changeCounts[g.projectId] ?? 0}
                                canUnpublish={canUnpublish}
                              />
                            </div>
                          </div>
                        </div>
                        {days.map((d, i) => (
                          <div
                            key={d}
                            style={{ gridRow: 1, gridColumn: i + 2 }}
                            className={`min-h-[24px] ${weekEdge(d)} ${cellTint(d, holidaySet, now)}`}
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
                          />
                        )}
                      </div>

                      {/* One row per phase, once the job is expanded */}
                      {open &&
                        (g.tasks.length === 0 ? (
                          <div className="px-4 py-3">
                            <p className="text-sm text-brand-gray">
                              Nothing scheduled on this job yet.{' '}
                              <button
                                className="font-medium text-brand-green-dark hover:underline"
                                onClick={() => setEditing({ projectId: g.projectId })}
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
                              onEdit={() => setEditing({ task: t })}
                              published={!!published[t.project_id]}
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
        Every live job is listed — expand one to see its phases, or whether it has any yet. A phase
        here is the work: how long it runs and how many people it takes. Who those people are, and
        what time they start, is settled a week at a time in the Crew Week. Views run in whole
        weeks from Monday, with each week&apos;s Monday held above its days; weekends and
        non-working days are shaded and never count toward a phase&apos;s duration. A phase marked
        &ldquo;starts after&rdquo; another moves automatically when the one before it slips, and
        moving any phase&apos;s dates asks for a reason that&apos;s kept with the job.
      </p>

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
}: {
  start: string | null;
  end: string | null;
  days: string[];
  rangeStart: string;
  rangeEnd: string;
  phases: number;
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
      className="z-10 my-2 flex h-6 items-center self-center overflow-hidden rounded bg-brand-gray/30 px-2 text-[11px] font-medium text-brand-ink"
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
  const staffedNote =
    budget.capacity === 0
      ? ''
      : budget.remaining === 0
        ? 'fully staffed'
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
  }${published ? '\nPublished — changes need a reason' : ''}`;

  return (
    <div className="grid" style={{ gridTemplateColumns: gridTemplate }}>
      {/* Everything in this row is pinned to grid row 1 on purpose: the bars are
          explicitly placed, and auto-placed cells would be bumped into a second
          row wherever a bar already occupies a column. */}
      <button
        onClick={onEdit}
        style={{ gridRow: 1, gridColumn: 1 }}
        className="sticky left-0 z-20 bg-white px-4 py-2 pl-9 text-left hover:bg-black/[.03]"
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
      </button>

      {days.map((d, i) => (
        <div
          key={d}
          style={{ gridRow: 1, gridColumn: i + 2 }}
          className={`h-11 ${weekEdge(d)} ${cellTint(d, holidaySet, now)}`}
        />
      ))}

      {segments.map((s, i) => (
        <button
          key={s.key}
          onClick={onEdit}
          title={tooltip}
          style={{ gridRow: 1, gridColumn: `${s.startIdx + 2} / ${s.endIdx + 3}` }}
          className={`z-10 my-2 flex items-center overflow-hidden rounded px-2 text-left text-[11px] font-medium text-white transition-opacity hover:opacity-90 ${
            BAR_TINT[task.status]
          } ${conflicted ? 'ring-2 ring-red-500 ring-offset-1' : ''} ${
            s.clippedLeft ? 'rounded-l-none' : ''
          } ${s.clippedRight ? 'rounded-r-none' : ''}`}
        >
          {/* Only the first visible stretch carries the label; the rest are the
              continuation of the same phase and stay clean. */}
          {i === 0 && (
            <span className="truncate">
              {task.name}
              <span className="opacity-80"> · {crewNote}</span>
              {budget.remaining > 0 && (
                <span className="opacity-80"> · {budget.remaining} to book</span>
              )}
            </span>
          )}
        </button>
      ))}
    </div>
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
