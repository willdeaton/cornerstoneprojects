/*
 * ============================================================================
 *  SCHEDULE DRAFT
 *
 *  The schedule is worked on as a DRAFT and sent to the crew when it is
 *  PUBLISHED. Two ideas, kept apart on purpose:
 *
 *   · SAVING is bookkeeping. Edits queue up in the browser as you work, and
 *     are written to the database on Save or by the ten-second autosave. A
 *     save never emails anybody, so a half-planned week is safe to leave.
 *   · PUBLISHING is telling people. It baselines the dates as the version the
 *     crew is working to and emails everyone booked on those jobs. It is the
 *     only thing in the app that sends a schedule email.
 *
 *  This module is the draft half, and it is pure — no database, no React — so
 *  the same edit list that renders the board is the one the server replays
 *  when it saves. Every view therefore shows the draft, not the last save:
 *  book four people on Tuesday and the crew week counts four straight away.
 *
 *  Replaying, rather than diffing, is what keeps the existing rules intact.
 *  A queued edit is the same call the editor used to make immediately, so the
 *  server's window, budget, dependency and reason checks all still run when
 *  the queue is flushed — in the order the edits were made.
 * ============================================================================
 */

import { computeSchedule } from './schedule-math';
import type {
  CrewDay,
  DependsType,
  ScheduleTaskRow,
  TaskDayTime,
  TaskStatus,
  WarehouseDay,
} from './types';

/** A phase's editable fields, as the phase editor holds them. */
export interface DraftTaskFields {
  project_id: number;
  name: string;
  start_date: string;
  duration_days: number;
  crew_size: number;
  subcontractor_id: number | null;
  depends_on_id: number | null;
  depends_type: DependsType;
  lag_days: number;
  status: TaskStatus;
  notes: string | null;
  /** Why it moved, when the change needs explaining. */
  reason: string | null;
}

/** The person a booking is for, with the names the board draws them under. */
export interface DraftPerson {
  kind: 'user' | 'sub';
  /** users.id or subcontractors.id, matching `kind`. */
  ref_id: number;
  name: string;
  /** Role for our people, trade for subs. */
  detail: string | null;
}

interface EditBase {
  /** Client-side sequence number — how the queue tracks and reports an edit. */
  editId: number;
  /** One line for the save bar and for a failure that has to be explained. */
  label: string;
}

/**
 * An edit that belongs to a job — every edit but a warehouse booking, which is
 * standing work with no job behind it.
 */
interface JobEditBase extends EditBase {
  projectId: number;
}

/**
 * Create or update one phase. A phase that doesn't exist yet carries a
 * NEGATIVE `taskId` — a placeholder the board and crew week can already book
 * against — and `preview`, the row they draw until the real one comes back.
 * `savedId` is stamped on once the save lands, so the placeholder drops out
 * the moment the real row arrives instead of briefly doubling up.
 */
export interface TaskSaveEdit extends JobEditBase {
  kind: 'task-save';
  taskId: number;
  fields: DraftTaskFields;
  preview?: ScheduleTaskRow;
  savedId?: number;
}

export interface TaskDeleteEdit extends JobEditBase {
  kind: 'task-delete';
  taskId: number;
  reason: string;
}

/** Book one person onto a run of days of one phase. */
export interface CrewBookEdit extends JobEditBase {
  kind: 'crew-book';
  taskId: number;
  person: DraftPerson;
  days: string[];
}

export interface CrewUnbookEdit extends JobEditBase {
  kind: 'crew-unbook';
  taskId: number;
  person: DraftPerson;
  days: string[];
}

/** The crew-facing half of a phase: the shift, and the notes they read. */
export interface CrewCardEdit extends JobEditBase {
  kind: 'crew-card';
  taskId: number;
  start_time: string | null;
  /** Hours on site each day; null is all day. */
  hours: number | null;
  day_times: TaskDayTime[];
  notes: string | null;
  reason: string | null;
}

/**
 * Put one person in the warehouse for a run of days. No task and no job: the
 * warehouse card is standing work, so the only thing an edit needs to name is
 * who and when.
 */
export interface WarehouseBookEdit extends EditBase {
  kind: 'warehouse-book';
  userId: number;
  /** The person as the board draws them while the edit is still pending. */
  person: DraftPerson;
  days: string[];
}

export interface WarehouseUnbookEdit extends EditBase {
  kind: 'warehouse-unbook';
  userId: number;
  person: DraftPerson;
  days: string[];
}

export type DraftEdit =
  | TaskSaveEdit
  | TaskDeleteEdit
  | CrewBookEdit
  | CrewUnbookEdit
  | CrewCardEdit
  | WarehouseBookEdit
  | WarehouseUnbookEdit;

/** An edit as the queue receives it — the editId is handed out by the queue. */
export type NewDraftEdit =
  | Omit<TaskSaveEdit, 'editId'>
  | Omit<TaskDeleteEdit, 'editId'>
  | Omit<CrewBookEdit, 'editId'>
  | Omit<CrewUnbookEdit, 'editId'>
  | Omit<CrewCardEdit, 'editId'>
  | Omit<WarehouseBookEdit, 'editId'>
  | Omit<WarehouseUnbookEdit, 'editId'>;

/** True for the placeholder id a phase carries before it has been saved. */
export function isDraftId(id: number): boolean {
  return id < 0;
}

/** The jobs a pending edit list touches, for "what is about to be saved". */
export function draftProjectIds(edits: DraftEdit[]): number[] {
  return [
    ...new Set(
      edits
        .filter((e): e is Exclude<DraftEdit, WarehouseBookEdit | WarehouseUnbookEdit> =>
          e.kind !== 'warehouse-book' && e.kind !== 'warehouse-unbook'
        )
        .map((e) => e.projectId)
    ),
  ];
}

/**
 * The board as it stands with every pending edit applied, newest last.
 *
 * Order matters and is the order they were made: booking somebody on Tuesday
 * and then taking them off again has to leave them off. Applying an edit twice
 * is harmless on purpose — a booking is added only if it isn't already there,
 * a removal of something already gone does nothing — because a just-saved edit
 * stays applied until the refreshed server rows arrive, and for a moment both
 * are in play.
 */
export function applyDraft(
  tasks: ScheduleTaskRow[],
  edits: DraftEdit[],
  holidays: string[] = []
): ScheduleTaskRow[] {
  if (edits.length === 0) return tasks;

  // Cloned down to the arrays the edits touch: the caller's rows are server
  // data that other views still hold.
  const byId = new Map<number, ScheduleTaskRow>(
    tasks.map((t) => [
      t.id,
      { ...t, crew_days: [...(t.crew_days ?? [])], day_times: [...(t.day_times ?? [])] },
    ])
  );
  const order: number[] = tasks.map((t) => t.id);
  let syntheticDay = -1;

  for (const edit of edits) {
    switch (edit.kind) {
      case 'task-save': {
        // The real row has arrived — the placeholder has done its job.
        if (edit.savedId != null && byId.has(edit.savedId)) break;
        const existing = byId.get(edit.taskId);
        if (existing) {
          byId.set(edit.taskId, { ...existing, ...fieldPatch(edit) });
        } else if (edit.preview) {
          byId.set(edit.taskId, {
            ...edit.preview,
            ...fieldPatch(edit),
            crew_days: [...(edit.preview.crew_days ?? [])],
            day_times: [...(edit.preview.day_times ?? [])],
          });
          order.push(edit.taskId);
        }
        break;
      }
      case 'task-delete': {
        byId.delete(edit.taskId);
        // Phases that followed it fall back to their own start date, which is
        // what the server does when the row goes.
        for (const [id, t] of byId) {
          if (t.depends_on_id === edit.taskId) byId.set(id, { ...t, depends_on_id: null });
        }
        break;
      }
      case 'crew-book': {
        const task = byId.get(edit.taskId);
        if (!task) break;
        const days = task.crew_days;
        for (const day of edit.days) {
          if (days.some((c) => c.day === day && samePerson(c, edit.person))) continue;
          days.push({
            id: syntheticDay--,
            day,
            kind: edit.person.kind,
            ref_id: edit.person.ref_id,
            name: edit.person.name,
            detail: edit.person.detail,
          });
        }
        days.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.name.localeCompare(b.name)));
        break;
      }
      case 'crew-unbook': {
        const task = byId.get(edit.taskId);
        if (!task) break;
        const drop = new Set(edit.days);
        task.crew_days = task.crew_days.filter(
          (c) => !(drop.has(c.day) && samePerson(c, edit.person))
        );
        break;
      }
      case 'crew-card': {
        const task = byId.get(edit.taskId);
        if (!task) break;
        byId.set(edit.taskId, {
          ...task,
          start_time: edit.start_time,
          hours: edit.hours,
          notes: edit.notes,
          day_times: [...edit.day_times],
        });
        break;
      }
    }
  }

  const out = order.map((id) => byId.get(id)).filter((t): t is ScheduleTaskRow => !!t);
  return pruneToWindows(out, holidays);
}

/**
 * The warehouse as it stands with every pending booking applied — the same
 * replay `applyDraft` does for phases, over the standing card's own rows.
 *
 * Kept as a second function rather than folded into `applyDraft` because the
 * two hold different things: a phase booking lives on the phase it belongs to,
 * and a warehouse day belongs to nothing but the day.
 */
export function applyWarehouseDraft(
  days: WarehouseDay[],
  edits: DraftEdit[]
): WarehouseDay[] {
  if (edits.length === 0) return days;
  let out = [...days];
  let syntheticId = -1;

  for (const edit of edits) {
    if (edit.kind === 'warehouse-book') {
      for (const day of edit.days) {
        if (out.some((w) => w.day === day && w.user_id === edit.userId)) continue;
        out.push({
          id: syntheticId--,
          day,
          user_id: edit.userId,
          name: edit.person.name,
          detail: edit.person.detail,
        });
      }
    } else if (edit.kind === 'warehouse-unbook') {
      const drop = new Set(edit.days);
      out = out.filter((w) => !(drop.has(w.day) && w.user_id === edit.userId));
    }
  }

  out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.name.localeCompare(b.name)));
  return out;
}

/** The fields of a phase an edit writes, as a patch over the row. */
function fieldPatch(edit: TaskSaveEdit): Partial<ScheduleTaskRow> {
  const f = edit.fields;
  return {
    project_id: f.project_id,
    name: f.name,
    start_date: f.start_date,
    duration_days: f.duration_days,
    crew_size: f.crew_size,
    subcontractor_id: f.subcontractor_id,
    depends_on_id: f.depends_on_id,
    depends_type: f.depends_type,
    lag_days: f.lag_days,
    status: f.status,
    notes: f.notes,
  };
}

function samePerson(c: Pick<CrewDay, 'kind' | 'ref_id'>, p: DraftPerson): boolean {
  return c.kind === p.kind && c.ref_id === p.ref_id;
}

/**
 * Drop bookings and day times that fall outside the phase they belong to —
 * exactly what the server does after a phase moves or shrinks, so a draft that
 * pulls a phase back to three days doesn't keep showing crew on the Thursday.
 */
function pruneToWindows(tasks: ScheduleTaskRow[], holidays: string[]): ScheduleTaskRow[] {
  const { windows } = computeSchedule(tasks, { holidays: new Set(holidays) });
  return tasks.map((t) => {
    const w = windows.get(t.id);
    if (!w) return t;
    const inside = (day: string) => day >= w.start && day <= w.end;
    const crew = t.crew_days.filter((c) => inside(c.day));
    const times = t.day_times.filter((d) => inside(d.day));
    if (crew.length === t.crew_days.length && times.length === t.day_times.length) return t;
    return { ...t, crew_days: crew, day_times: times };
  });
}
