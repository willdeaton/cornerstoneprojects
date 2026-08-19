'use client';

import { useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { shortDate } from '@/lib/format';
import { computeSchedule, today, workedSegments, workingDaySpan } from '@/lib/schedule-math';
import { diffTask, movesTimeline, needsReason, summarizeChanges } from '@/lib/schedule-diff';
import type { DependsType, ScheduleTaskRow, TaskStatus } from '@/lib/types';
import { TASK_STATUS_LABELS } from '@/lib/types';
import { saveTaskAction, deleteTaskAction } from '@/app/actions/schedule';

export interface ProjectOption {
  id: number;
  name: string;
  customer: string;
  due_date: string | null;
  /** The date the job must be finished by, when it has one. */
  hard_finish_date?: string | null;
}
export interface WorkerOption {
  id: number;
  name: string;
  role: string;
}
export interface SubOption {
  id: number;
  name: string;
  trade: string | null;
}

/**
 * Plan one phase of work: what it is, when it can start, how long it runs and
 * how many people it takes. The dates shown under the duration field are the
 * real computed ones — this runs the same solver the timeline does, so a phase
 * that follows another shows where it actually lands before you save.
 *
 * Deliberately no names and no start times. A phase says it needs three people
 * for four days; WHO those three are, and what time they turn up, is settled in
 * the crew week where the days are actually in front of you. Duration and crew
 * size together are the phase's budget — crew_size x working days — and the
 * crew week can't book past it.
 *
 * Moving the dates always requires a reason, and once the job's schedule is
 * published so does changing the headcount — the exact wording that gets logged
 * is previewed before you commit.
 */
export function TaskModal({
  task,
  allTasks,
  projects,
  holidays,
  defaultProjectId,
  initialProjectId,
  publishedVersions,
  onClose,
  onSaved,
}: {
  /** Existing phase to edit, or undefined to create one. */
  task?: ScheduleTaskRow;
  /** Every phase in scope — used for the predecessor picker and the preview. */
  allTasks: ScheduleTaskRow[];
  projects: ProjectOption[];
  holidays: string[];
  /** Pre-selects (and locks) the job when opened from a project page. */
  defaultProjectId?: number;
  /** Pre-selects a job while still letting it be changed — used by the board. */
  initialProjectId?: number;
  /** Published version per job id — jobs listed here need change reasons. */
  publishedVersions?: Record<number, number>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [projectId, setProjectId] = useState<number>(
    task?.project_id ?? defaultProjectId ?? initialProjectId ?? projects[0]?.id ?? 0
  );
  const [name, setName] = useState(task?.name ?? '');
  const [startDate, setStartDate] = useState(task?.start_date ?? today());
  const [duration, setDuration] = useState(String(task?.duration_days ?? 5));
  const [crewSize, setCrewSize] = useState(String(task?.crew_size ?? 1));
  const [dependsOn, setDependsOn] = useState<number | null>(task?.depends_on_id ?? null);
  const [dependsType, setDependsType] = useState<DependsType>(
    task?.depends_type ?? 'finish_to_start'
  );
  const [lag, setLag] = useState(String(task?.lag_days ?? 0));
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'not_started');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const calendar = useMemo(() => ({ holidays: new Set(holidays) }), [holidays]);
  // Opened from a job's own page, the job is fixed — phases don't move between jobs.
  const projectLocked = defaultProjectId != null;
  const publishedVersion = publishedVersions?.[projectId] ?? null;

  // Phases available as a predecessor: same job, never the phase itself.
  const predecessorOptions = useMemo(
    () => allTasks.filter((t) => t.project_id === projectId && t.id !== task?.id),
    [allTasks, projectId, task?.id]
  );

  const durationDays = Math.max(1, Math.round(Number(duration) || 1));
  const crew = Math.max(1, Math.round(Number(crewSize) || 1));

  // Run the solver over the job as it would be after this edit, so the preview
  // reflects the real chain rather than just the typed start date.
  const preview = useMemo(() => {
    const lagDays = Math.max(0, Math.round(Number(lag) || 0));
    const draftId = task?.id ?? -1;
    const others = allTasks
      .filter((t) => t.project_id === projectId && t.id !== task?.id)
      .map((t) => ({
        id: t.id,
        project_id: t.project_id,
        start_date: t.start_date,
        duration_days: t.duration_days,
        depends_on_id: t.depends_on_id,
        depends_type: t.depends_type,
        lag_days: t.lag_days,
      }));
    const draft = {
      id: draftId,
      project_id: projectId,
      start_date: startDate,
      duration_days: durationDays,
      depends_on_id: dependsOn,
      depends_type: dependsType,
      lag_days: lagDays,
    };
    const { windows } = computeSchedule([...others, draft], calendar);
    return windows.get(draftId) ?? null;
  }, [allTasks, projectId, task?.id, startDate, durationDays, lag, dependsOn, dependsType, calendar]);

  // The budget the crew week gets to spend on this phase.
  const workingDays = preview ? workingDaySpan(preview.start, preview.end, calendar) : 0;
  const capacity = crew * workingDays;
  // Crew already booked on days this phase would no longer cover: changing the
  // dates or the duration drops them, which is worth saying before it happens.
  const orphaned = useMemo(() => {
    if (!task || !preview) return 0;
    return (task.crew_days ?? []).filter((d) => d.day < preview.start || d.day > preview.end).length;
  }, [task, preview]);
  const booked = (task?.crew_days ?? []).length;
  const overBooked = Math.max(0, booked - orphaned - capacity);

  // The wording that gets logged, and whether a reason is required at all: an
  // edit that only marks progress doesn't need one, even on a published job.
  const changes = useMemo(() => {
    if (!task) return null;
    const names = { phase: (id: number) => allTasks.find((t) => t.id === id)?.name ?? 'a deleted phase' };
    const unchanged = {
      // Set from the crew week, never here — carried through so they can't read
      // as a change.
      start_time: task.start_time ?? null,
      day_times: task.day_times ?? [],
    };
    return diffTask(
      {
        name: task.name,
        start_date: task.start_date,
        duration_days: task.duration_days,
        depends_on_id: task.depends_on_id,
        depends_type: task.depends_type ?? 'finish_to_start',
        lag_days: task.lag_days,
        crew_size: task.crew_size,
        notes: task.notes,
        status: task.status,
        ...unchanged,
      },
      {
        name: name.trim(),
        start_date: startDate,
        duration_days: durationDays,
        depends_on_id: dependsOn,
        depends_type: dependsType,
        lag_days: Math.max(0, Math.round(Number(lag) || 0)),
        crew_size: crew,
        notes: notes.trim() === '' ? null : notes.trim(),
        status,
        ...unchanged,
      },
      names
    );
  }, [
    task,
    allTasks,
    name,
    startDate,
    durationDays,
    dependsOn,
    dependsType,
    lag,
    crew,
    notes,
    status,
  ]);

  // Moving the dates always needs explaining; changing the headcount needs it
  // once the crew has the schedule. A new phase only needs it on a published job.
  const reasonRequired = task
    ? !!changes && needsReason(changes, publishedVersion != null)
    : publishedVersion != null;
  const timelineMoved = !!changes && movesTimeline(changes);

  async function submit() {
    setError(null);
    setSaving(true);
    const res = await saveTaskAction({
      id: task?.id,
      project_id: projectId,
      name,
      start_date: startDate,
      duration_days: durationDays,
      crew_size: crew,
      depends_on_id: dependsOn,
      depends_type: dependsType,
      lag_days: Math.max(0, Math.round(Number(lag) || 0)),
      status,
      notes,
      reason,
    });
    if (res.ok) onSaved();
    else {
      setError(res.error ?? 'Could not save.');
      setSaving(false);
    }
  }

  async function remove() {
    if (!task) return;
    const following = allTasks.filter((t) => t.depends_on_id === task.id).length;
    const warning = following
      ? `Delete "${task.name}"? ${following} later phase${following > 1 ? 's' : ''} will no longer follow it and will fall back to its own start date.`
      : `Delete "${task.name}"?`;
    if (!confirm(warning)) return;

    // Dropping work out of a job moves its timeline, so the removal is explained
    // whether or not the schedule has gone out.
    let why = reason.trim();
    if (!why) {
      const typed = prompt(
        publishedVersion != null
          ? `This job's schedule is published (v${publishedVersion}). Why is this phase being removed?`
          : 'Why is this phase being removed? The job keeps this with its change history.'
      );
      if (typed == null) return;
      why = typed.trim();
      if (!why) {
        setError('A reason is required to remove a phase.');
        return;
      }
    }

    setSaving(true);
    const res = await deleteTaskAction(task.id, why);
    if (res.ok) onSaved();
    else {
      setError(res.error ?? 'Could not delete.');
      setSaving(false);
    }
  }

  const project = projects.find((p) => p.id === projectId);
  const dueDate = project?.due_date ?? null;
  const hardFinish = project?.hard_finish_date ?? null;
  const pastDue = preview && dueDate ? preview.end > dueDate : false;
  const pastHardFinish = preview && hardFinish ? preview.end > hardFinish : false;
  // Working stretches of the phase itself — one per week, so the preview shows
  // the same weekend breaks the timeline does.
  const segments = preview ? workedSegments(preview.start, preview.end, calendar) : [];

  return (
    <Modal open onClose={onClose} title={task ? 'Edit Phase' : 'Schedule Work'} wide>
      <div className="space-y-4">
        {publishedVersion != null ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-semibold">Published schedule (v{publishedVersion})</p>
            <p>
              The crew has these dates. Any change to the dates, duration, links or the crew this
              phase needs requires a reason, which is saved to this job&apos;s change history.
            </p>
          </div>
        ) : (
          task && (
            <p className="text-xs text-brand-gray">
              Moving this phase&apos;s dates, duration or link needs a reason — it&apos;s kept in
              this job&apos;s change history so you can look back on what moved and why.
            </p>
          )
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Job *</label>
            <select
              className="input"
              value={projectId}
              disabled={projectLocked}
              onChange={(e) => {
                setProjectId(Number(e.target.value));
                setDependsOn(null);
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.customer}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Phase *</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Framing"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label">{dependsOn ? 'Earliest Start' : 'Start Date'} *</label>
            <input
              className="input"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Duration (working days)</label>
            <input
              className="input"
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Crew Needed (people per day)</label>
            <input
              className="input"
              type="number"
              min={1}
              value={crewSize}
              onChange={(e) => setCrewSize(e.target.value)}
            />
          </div>
        </div>

        {/* Phase links. Start-to-start is what lets a sub run alongside an
            earlier phase instead of waiting for it to finish. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Starts After</label>
            <select
              className="input"
              value={dependsOn ?? ''}
              onChange={(e) => setDependsOn(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Nothing — starts on its own date</option>
              {predecessorOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Relative To</label>
            <select
              className="input"
              value={dependsType}
              disabled={dependsOn == null}
              onChange={(e) => setDependsType(e.target.value as DependsType)}
            >
              <option value="finish_to_start">When that phase finishes</option>
              <option value="start_to_start">When that phase starts (can overlap)</option>
            </select>
          </div>
          <div>
            <label className="label">
              {dependsType === 'start_to_start' ? 'Days After It Starts' : 'Wait After It Finishes'}
            </label>
            <input
              className="input"
              type="number"
              min={0}
              value={lag}
              disabled={dependsOn == null}
              onChange={(e) => setLag(e.target.value)}
            />
          </div>
        </div>

        {dependsOn != null && (
          <p className="text-xs text-brand-gray">
            {dependsType === 'start_to_start'
              ? `Starts ${Math.max(0, Math.round(Number(lag) || 0))} working day${
                  Math.round(Number(lag) || 0) === 1 ? '' : 's'
                } after "${predecessorOptions.find((t) => t.id === dependsOn)?.name ?? 'that phase'}" begins — the two phases run alongside each other.`
              : `Starts after "${predecessorOptions.find((t) => t.id === dependsOn)?.name ?? 'that phase'}" is complete.`}
          </p>
        )}

        {/* Live result of the dependency chain, weekends and holidays included,
            with the crew budget it adds up to. */}
        {preview && (
          <div className="rounded-lg border border-black/10 bg-black/[.02] px-4 py-3 text-sm">
            <p className="font-semibold text-brand-ink">
              {shortDate(preview.start)} → {shortDate(preview.end)}
            </p>
            <p className="mt-0.5 text-brand-gray">
              {workingDays} working days
              {preview.driven && ' · pushed out by the phase it follows'}
            </p>
            <p className="mt-1 font-medium text-brand-ink">
              {crew} {crew === 1 ? 'person' : 'people'} a day × {workingDays} working{' '}
              {workingDays === 1 ? 'day' : 'days'} = {capacity} crew{' '}
              {capacity === 1 ? 'day' : 'days'} to fill in the crew week
            </p>
            {segments.length > 1 && (
              <p className="mt-1 text-brand-gray">
                Runs in {segments.length} stretches (weekends and non-working days off):{' '}
                {segments
                  .map((s) =>
                    s.start === s.end
                      ? shortDate(s.start)
                      : `${shortDate(s.start)}–${shortDate(s.end)}`
                  )
                  .join(', ')}
              </p>
            )}
            {orphaned > 0 && (
              <p className="mt-1 font-medium text-amber-700">
                {orphaned} crew {orphaned === 1 ? 'day is' : 'days are'} booked outside these
                dates and will be dropped — re-book {orphaned === 1 ? 'it' : 'them'} in the crew
                week.
              </p>
            )}
            {overBooked > 0 && (
              <p className="mt-1 font-medium text-amber-700">
                {booked - orphaned} crew days are already booked, which is {overBooked} more than
                this leaves room for. Nothing is dropped, but the phase will read as
                over-staffed until you raise the crew or take someone off.
              </p>
            )}
            {pastHardFinish && (
              <p className="mt-1 font-semibold text-red-700">
                Ends after this job&apos;s hard finish date of {shortDate(hardFinish)} — that date
                can&apos;t move.
              </p>
            )}
            {pastDue && !pastHardFinish && (
              <p className="mt-1 font-medium text-amber-700">
                Ends after this job&apos;s due date of {shortDate(dueDate)}.
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-brand-gray">
          Who works this phase, what time they start and the notes they read are all set on its
          card in the <span className="font-medium text-brand-ink">Crew Week</span> — a week at a
          time, against the days themselves.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
            >
              {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Notes</label>
            <input
              className="input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Gate code 4471, dumpster on the north side"
            />
          </div>
        </div>

        {(publishedVersion != null || (task && changes && changes.length > 0)) && (
          <div>
            <label className="label">
              Reason For Change{' '}
              {reasonRequired ? '*' : <span className="text-brand-gray">(optional)</span>}
            </label>
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Customer pushed the start back a week"
            />
            {changes && changes.length > 0 && (
              <p className="mt-1 text-xs text-brand-gray">
                Will be logged as: {summarizeChanges(changes)}
              </p>
            )}
            {timelineMoved && (
              <p className="mt-1 text-xs font-medium text-amber-700">
                This moves the timeline, so a reason is required.
              </p>
            )}
            {!reasonRequired && task && (
              <p className="mt-1 text-xs text-brand-gray">
                {changes && changes.length > 0
                  ? "The dates aren't moving, so a reason is optional — one you give is still kept in the history."
                  : 'Nothing has changed yet.'}
              </p>
            )}
          </div>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {task ? (
            <button
              className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              onClick={remove}
              disabled={saving}
            >
              Delete Phase
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={submit}
              disabled={saving || (reasonRequired && reason.trim() === '')}
              title={
                reasonRequired && reason.trim() === ''
                  ? timelineMoved
                    ? 'A reason is required when the dates move'
                    : 'A reason is required to change a published schedule'
                  : undefined
              }
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
