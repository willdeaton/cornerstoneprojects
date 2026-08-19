/*
 * ============================================================================
 *  SCHEDULE DIFF
 *
 *  What changed about a phase, in words. Pure — no database — so the phase
 *  editor can tell you a reason will be required before you save, and the
 *  server can write the same wording into the change log when you do.
 *
 *  Two flavours of relevance:
 *
 *   · TIMELINE — the dates themselves move: start, duration, or the link to
 *     another phase. These always need a reason, published or not, because the
 *     point of the history is to answer "why did this move?" later.
 *   · SCHEDULE — work or people shift without the timeline moving: the crew,
 *     the daily start times, the crew-facing notes. These need a reason once
 *     the schedule has been published to the crew.
 *
 *  Marking a phase in progress or complete is progress reporting, not a
 *  schedule change, so it never demands a reason.
 * ============================================================================
 */

import { shortDate } from './format';
import { maskLabel, timeLabel } from './schedule-math';
import type { DependsType, ScheduleAssignee, TaskDayTime, TaskStatus } from './types';
import { TASK_STATUS_LABELS } from './types';

/** The editable shape of a phase, as both the modal and the action hold it. */
export interface TaskDraft {
  name: string;
  start_date: string;
  duration_days: number;
  depends_on_id: number | null;
  depends_type: DependsType;
  lag_days: number;
  /** Daily start time as 'HH:MM', or null for the crew's normal hours. */
  start_time: string | null;
  /** Per-day start-time overrides. */
  day_times: TaskDayTime[];
  notes: string | null;
  status: TaskStatus;
  assignees: { kind: 'user' | 'sub'; ref_id: number; work_days?: number | null }[];
}

/** What a phase looked like before the edit. */
export interface TaskBefore {
  name: string;
  start_date: string;
  duration_days: number;
  depends_on_id: number | null;
  depends_type: DependsType;
  lag_days: number;
  start_time: string | null;
  day_times: TaskDayTime[];
  notes: string | null;
  status: TaskStatus;
  assignees: Pick<ScheduleAssignee, 'kind' | 'ref_id' | 'name' | 'work_days'>[];
}

export interface FieldChange {
  label: string;
  from: string;
  to: string;
  /** False for progress-only edits (status), which never need a reason. */
  scheduleRelevant: boolean;
  /** True when the dates themselves moved — always needs a reason. */
  timelineRelevant: boolean;
}

/** Looks up display names for phases and people referenced by id. */
export interface DiffNames {
  phase: (id: number) => string;
  person: (kind: 'user' | 'sub', refId: number) => string;
}

const DEPENDS_LABEL: Record<DependsType, string> = {
  finish_to_start: 'after it finishes',
  start_to_start: 'after it starts',
};

/** How a phase's link to another reads in one line. */
export function describeLink(
  dependsOnId: number | null,
  type: DependsType,
  lagDays: number,
  names: DiffNames
): string {
  if (dependsOnId == null) return 'Own start date';
  const wait = lagDays === 0 ? '' : ` + ${lagDays} working day${lagDays === 1 ? '' : 's'}`;
  return `${names.phase(dependsOnId)} — ${DEPENDS_LABEL[type]}${wait}`;
}

/** "Dave Ruiz (Mon, Wed)" — a crew line that shows any split-day pattern. */
function personLabel(name: string, workDays: number | null | undefined): string {
  return workDays == null ? name : `${name} (${maskLabel(workDays)})`;
}

function crewLabel(
  people: { kind: 'user' | 'sub'; ref_id: number; work_days?: number | null; name?: string }[],
  names: DiffNames
): string {
  if (people.length === 0) return 'Nobody';
  return [...people]
    .map((p) => personLabel(p.name ?? names.person(p.kind, p.ref_id), p.work_days))
    .sort((a, b) => a.localeCompare(b))
    .join(', ');
}

/** "Mar 4 at 6:00 AM, Mar 5 (no set time)" — the per-day start-time overrides. */
function dayTimesLabel(days: TaskDayTime[]): string {
  if (days.length === 0) return 'None';
  return [...days]
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map((d) =>
      d.start_time
        ? `${shortDate(d.day)} at ${timeLabel(d.start_time)}`
        : `${shortDate(d.day)} (no set time)`
    )
    .join(', ');
}

/** Every field that differs between the saved phase and the draft. */
export function diffTask(before: TaskBefore, draft: TaskDraft, names: DiffNames): FieldChange[] {
  const out: FieldChange[] = [];
  const push = (
    label: string,
    from: string,
    to: string,
    relevance: { schedule?: boolean; timeline?: boolean } = {}
  ) => {
    if (from === to) return;
    out.push({
      label,
      from,
      to,
      scheduleRelevant: relevance.schedule ?? true,
      timelineRelevant: relevance.timeline ?? false,
    });
  };

  push('Phase name', before.name, draft.name);
  // The three fields that actually move the dates.
  push('Start', shortDate(before.start_date), shortDate(draft.start_date), { timeline: true });
  push(
    'Duration',
    `${before.duration_days} working days`,
    `${draft.duration_days} working days`,
    { timeline: true }
  );
  push(
    'Follows',
    describeLink(before.depends_on_id, before.depends_type, before.lag_days, names),
    describeLink(draft.depends_on_id, draft.depends_type, draft.lag_days, names),
    { timeline: true }
  );
  push('Crew', crewLabel(before.assignees, names), crewLabel(draft.assignees, names));
  push(
    'Daily start time',
    before.start_time ? timeLabel(before.start_time) : 'Not set',
    draft.start_time ? timeLabel(draft.start_time) : 'Not set'
  );
  push('Day start times', dayTimesLabel(before.day_times), dayTimesLabel(draft.day_times));
  push('Notes', before.notes ?? '—', draft.notes ?? '—');
  push(
    'Status',
    TASK_STATUS_LABELS[before.status],
    TASK_STATUS_LABELS[draft.status],
    // Progress, not planning.
    { schedule: false }
  );

  return out;
}

/**
 * Whether these changes have to carry a typed reason.
 *
 * Anything that moves the dates does, always — that's the history managers read
 * back later. Everything else that moves work or people (crew, start times,
 * crew notes) does once the schedule has been published to the crew.
 */
export function needsReason(changes: FieldChange[], published = false): boolean {
  return changes.some((c) => c.timelineRelevant || (published && c.scheduleRelevant));
}

/** True when the dates themselves moved. */
export function movesTimeline(changes: FieldChange[]): boolean {
  return changes.some((c) => c.timelineRelevant);
}

/** "Start Mar 3 → Mar 5; Duration 5 working days → 7 working days" */
export function summarizeChanges(changes: FieldChange[]): string {
  return changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join('; ');
}

/** One-line summary for a phase being added to (or dropped from) a job. */
export function summarizePhase(draft: {
  name: string;
  start_date: string;
  duration_days: number;
}): string {
  return `${draft.name} — starts ${shortDate(draft.start_date)}, ${draft.duration_days} working day${
    draft.duration_days === 1 ? '' : 's'
  }`;
}
