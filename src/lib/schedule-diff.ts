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
 *   · SCHEDULE — work or people shift without the timeline moving: how many
 *     people the phase needs, the daily start times, the crew-facing notes.
 *     These need a reason once the schedule has been published to the crew.
 *
 *  Marking a phase in progress or complete is progress reporting, not a
 *  schedule change, so it never demands a reason.
 * ============================================================================
 */

import { shortDate } from './format';
import { hoursLabel, shiftLabel, timeLabel } from './schedule-math';
import type { DependsType, TaskDayTime, TaskStatus } from './types';
import { TASK_STATUS_LABELS } from './types';

/** The editable shape of a phase, as both the modal and the action hold it. */
export interface TaskDraft {
  name: string;
  start_date: string;
  duration_days: number;
  depends_on_id: number | null;
  depends_type: DependsType;
  lag_days: number;
  /** Our people needed per day. */
  crew_size: number;
  /** The sub doing this phase, or null when it's our crew's work. */
  subcontractor_id: number | null;
  /** Daily start time as 'HH:MM', or null for the crew's normal hours. */
  start_time: string | null;
  /** Hours on site each day; null is all day, which is the default. */
  hours: number | null;
  /** Per-day shift overrides. */
  day_times: TaskDayTime[];
  notes: string | null;
  status: TaskStatus;
}

/** What a phase looked like before the edit. */
export interface TaskBefore {
  name: string;
  start_date: string;
  duration_days: number;
  depends_on_id: number | null;
  depends_type: DependsType;
  lag_days: number;
  crew_size: number;
  subcontractor_id: number | null;
  start_time: string | null;
  hours: number | null;
  day_times: TaskDayTime[];
  notes: string | null;
  status: TaskStatus;
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

/** Looks up display names for phases and subcontractors referenced by id. */
export interface DiffNames {
  phase: (id: number) => string;
  sub: (id: number) => string;
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

/**
 * "Mar 4 6:00 AM – 10:00 AM · 4h, Mar 5 all day" — the per-day shift
 * overrides, each day with whatever it was given.
 */
function dayTimesLabel(days: TaskDayTime[]): string {
  if (days.length === 0) return 'None';
  return [...days]
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map((d) => {
      const shift = shiftLabel({ startTime: d.start_time, hours: d.hours ?? null });
      // "Mar 5 no set time" reads better than "Mar 5 All day" for a day that
      // was deliberately exempted from the phase's own start time.
      if (!d.start_time && d.hours == null) return `${shortDate(d.day)} (no set time)`;
      return `${shortDate(d.day)} ${shift}`;
    })
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
  push(
    'Subcontractor',
    before.subcontractor_id == null ? 'Our crew' : names.sub(before.subcontractor_id),
    draft.subcontractor_id == null ? 'Our crew' : names.sub(draft.subcontractor_id)
  );
  push('Crew needed', crewSizeLabel(before.crew_size), crewSizeLabel(draft.crew_size));
  push(
    'Daily start time',
    before.start_time ? timeLabel(before.start_time) : 'Not set',
    draft.start_time ? timeLabel(draft.start_time) : 'Not set'
  );
  push('Hours on site', hoursLabel(before.hours), hoursLabel(draft.hours));
  push('Day shifts', dayTimesLabel(before.day_times), dayTimesLabel(draft.day_times));
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

/** "2 people per day" — how the headcount reads in the change log. */
function crewSizeLabel(size: number): string {
  if (size === 0) return 'None of our crew';
  return `${size} ${size === 1 ? 'person' : 'people'} per day`;
}

/** One-line summary for a phase being added to (or dropped from) a job. */
export function summarizePhase(draft: {
  name: string;
  start_date: string;
  duration_days: number;
  crew_size?: number;
  subcontractor_name?: string | null;
}): string {
  const crew = draft.subcontractor_name
    ? `, subcontracted to ${draft.subcontractor_name}`
    : draft.crew_size
      ? `, ${crewSizeLabel(draft.crew_size)}`
      : '';
  return `${draft.name} — starts ${shortDate(draft.start_date)}, ${draft.duration_days} working day${
    draft.duration_days === 1 ? '' : 's'
  }${crew}`;
}
