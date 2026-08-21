'use client';

import { useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { shortDate } from '@/lib/format';
import {
  DAY_LABELS,
  computeSchedule,
  crewRoster,
  fromDay,
  isWorkingDay,
  mergeDays,
  today,
  workedSegments,
  workingDaySpan,
  type ComputedWindow,
  type WorkCalendar,
} from '@/lib/schedule-math';
import { diffTask, movesTimeline, needsReason, summarizeChanges } from '@/lib/schedule-diff';
import type { DependsType, ScheduleTaskRow, TaskStatus } from '@/lib/types';
import { TASK_STATUS_LABELS } from '@/lib/types';
import { isDraftId, type DraftTaskFields } from '@/lib/schedule-draft';
import { saveTaskAction, deleteTaskAction } from '@/app/actions/schedule';
import type { ScheduleDraft } from './useScheduleDraft';

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
  /**
   * False when they've been taken out of scheduling under Settings -> Users.
   * The crew week leaves them out of the grid unless they're already booked.
   * Absent counts as schedulable, which is how everybody started.
   */
  schedulable?: boolean;
}
export interface SubOption {
  id: number;
  name: string;
  trade: string | null;
}

/**
 * Plan one phase of work: what it is, when it can start, how long it runs, and
 * who does it — our own crew, or a subcontractor. The dates shown under the
 * duration field are the real computed ones: this runs the same solver the
 * timeline does, so a phase that follows another shows where it actually lands
 * before you save.
 *
 * The two kinds of work are picked differently on purpose. Our crew is a
 * HEADCOUNT here and named later: a phase says it needs three people for four
 * days, and who those three are is settled in the crew week where the days are
 * in front of you. Duration x headcount is the phase's budget, and the crew week
 * can't book past it. A subcontractor is chosen HERE, because that's when the
 * work is contracted — their days on site then follow the phase's dates, so a
 * phase that slips takes them with it and there's nothing to re-book.
 *
 * A subcontracted phase can still ask for our people alongside the sub, which is
 * how the supervisor we send gets scheduled.
 *
 * No start times either way — those belong to particular days, so they're set
 * on the phase's card in the crew week.
 *
 * Moving the dates always requires a reason, and once the job's schedule is
 * published so does changing the sub or the headcount — the exact wording that
 * gets logged is previewed before you commit.
 */
export function TaskModal({
  task,
  allTasks,
  projects,
  subs,
  holidays,
  defaultProjectId,
  initialProjectId,
  publishedVersions,
  draft,
  onClose,
  onSaved,
}: {
  /** Existing phase to edit, or undefined to create one. */
  task?: ScheduleTaskRow;
  /** Every phase in scope — used for the predecessor picker and the preview. */
  allTasks: ScheduleTaskRow[];
  projects: ProjectOption[];
  /** The subcontractor catalog, for phases that are contracted out. */
  subs: SubOption[];
  holidays: string[];
  /** Pre-selects (and locks) the job when opened from a project page. */
  defaultProjectId?: number;
  /** Pre-selects a job while still letting it be changed — used by the board. */
  initialProjectId?: number;
  /** Published version per job id — jobs listed here need change reasons. */
  publishedVersions?: Record<number, number>;
  /**
   * The schedule's draft, on the schedule page. With it, saving queues the
   * phase into the draft and the board redraws at once; without it — the job
   * page, which has no draft of its own — the phase is written immediately.
   * Either way nothing is emailed: only publishing does that.
   */
  draft?: ScheduleDraft;
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
  /** null = our own crew does this phase; an id = the sub contracted for it. */
  const [subId, setSubId] = useState<number | null>(task?.subcontractor_id ?? null);
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
  const subbed = subId != null;
  // Only a subcontracted phase may ask for none of our people.
  const crew = subbed
    ? Math.max(0, Math.round(Number(crewSize) || 0))
    : Math.max(1, Math.round(Number(crewSize) || 1));
  const sub = subs.find((s) => s.id === subId);

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
    const names = {
      phase: (id: number) => allTasks.find((t) => t.id === id)?.name ?? 'a deleted phase',
      // The picker lists only active subs, so fall back to the name already on
      // the phase — a sub since deactivated would otherwise read as a change.
      sub: (id: number) =>
        subs.find((x) => x.id === id)?.name ??
        (task?.subcontractor_id === id ? task.subcontractor_name : null) ??
        `#${id}`,
    };
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
        subcontractor_id: task.subcontractor_id,
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
        subcontractor_id: subId,
        notes: notes.trim() === '' ? null : notes.trim(),
        status,
        ...unchanged,
      },
      names
    );
  }, [
    task,
    allTasks,
    subs,
    name,
    startDate,
    durationDays,
    dependsOn,
    dependsType,
    lag,
    crew,
    subId,
    notes,
    status,
  ]);

  // Moving the dates always needs explaining; changing the headcount needs it
  // once the crew has the schedule. A new phase only needs it on a published job.
  const reasonRequired = task
    ? !!changes && needsReason(changes, publishedVersion != null)
    : publishedVersion != null;
  const timelineMoved = !!changes && movesTimeline(changes);

  /** The phase as it stands in the editor. */
  function fields(): DraftTaskFields {
    return {
      project_id: projectId,
      name: name.trim(),
      start_date: startDate,
      duration_days: durationDays,
      crew_size: crew,
      subcontractor_id: subId,
      depends_on_id: dependsOn,
      depends_type: dependsType,
      lag_days: Math.max(0, Math.round(Number(lag) || 0)),
      status,
      notes: notes.trim() === '' ? null : notes.trim(),
      reason: reason.trim() === '' ? null : reason.trim(),
    };
  }

  async function submit() {
    setError(null);
    if (name.trim() === '') {
      setError('Give the phase a name.');
      return;
    }
    setSaving(true);

    if (draft) {
      // Into the draft, where the board picks it up immediately. A phase that
      // doesn't exist yet gets a placeholder id it can be booked against; the
      // real one arrives when the draft is saved.
      const id = task?.id ?? draft.newTaskId();
      draft.queue({
        kind: 'task-save',
        projectId,
        taskId: id,
        label: `${name.trim()} (${projects.find((p) => p.id === projectId)?.name ?? 'job'})`,
        fields: fields(),
        preview: task ? undefined : previewRow(id),
      });
      onSaved();
      return;
    }

    const f = fields();
    const res = await saveTaskAction({ id: task?.id, ...f, notes: f.notes, reason: f.reason });
    if (res.ok) onSaved();
    else {
      setError(res.error ?? 'Could not save.');
      setSaving(false);
    }
  }

  /**
   * The row the board draws for a phase that hasn't been saved yet. Job details
   * come from the picked job, so a brand-new phase reads the same as a saved
   * one on the timeline and in the crew week.
   */
  function previewRow(id: number): ScheduleTaskRow {
    const job = projects.find((p) => p.id === projectId);
    const f = fields();
    const now = new Date().toISOString();
    return {
      id,
      project_id: projectId,
      name: f.name,
      start_date: f.start_date,
      duration_days: f.duration_days,
      crew_size: f.crew_size,
      subcontractor_id: f.subcontractor_id,
      depends_on_id: f.depends_on_id,
      depends_type: f.depends_type,
      lag_days: f.lag_days,
      status: f.status,
      start_time: null,
      notes: f.notes,
      position: 0,
      created_at: now,
      updated_at: now,
      project_name: job?.name ?? 'This job',
      customer: job?.customer ?? '',
      location: null,
      site_address: null,
      project_status: 'in_progress',
      project_due_date: job?.due_date ?? null,
      project_hard_finish_date: job?.hard_finish_date ?? null,
      subcontractor_name: subs.find((s) => s.id === f.subcontractor_id)?.name ?? null,
      crew_days: [],
      day_times: [],
    };
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

    if (draft) {
      // A phase that only ever existed in the draft just leaves it, together
      // with anything queued against it — nothing was written to undo.
      if (isDraftId(task.id)) draft.dropTask(task.id);
      else {
        draft.queue({
          kind: 'task-delete',
          projectId: task.project_id,
          taskId: task.id,
          label: `Remove ${task.name} (${task.project_name})`,
          reason: why,
        });
      }
      onSaved();
      return;
    }

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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </div>

        {/* Who does the work. Our crew is a headcount the crew week fills with
            names; a sub is picked here and their days follow the phase. */}
        <div className="rounded-lg border border-black/10 p-3">
          <label className="label">Work Done By</label>
          <div className="flex overflow-hidden rounded-lg border border-black/10">
            <button
              type="button"
              onClick={() => {
                setSubId(null);
                // Coming back from a sub phase that needed none of our people,
                // one is the only sensible headcount to land on.
                if (Math.round(Number(crewSize) || 0) < 1) setCrewSize('1');
              }}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                !subbed ? 'bg-brand-green font-semibold text-brand-ink' : 'text-brand-gray hover:bg-black/5'
              }`}
            >
              Our Crew
            </button>
            <button
              type="button"
              onClick={() => {
                if (subs.length === 0) return;
                setSubId(subs[0].id);
                // A subcontracted phase usually needs nobody of ours on it.
                setCrewSize('0');
              }}
              disabled={subs.length === 0}
              title={
                subs.length === 0
                  ? 'Add subcontractors under Settings → Subcontractors first'
                  : undefined
              }
              className={`border-l border-black/10 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                subbed ? 'bg-brand-green font-semibold text-brand-ink' : 'text-brand-gray hover:bg-black/5'
              }`}
            >
              A Subcontractor
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {subbed && (
              <div>
                <label className="label">Subcontractor *</label>
                <select
                  className="input"
                  value={subId ?? ''}
                  onChange={(e) => setSubId(Number(e.target.value))}
                >
                  {/* A sub deactivated since this phase was planned still needs
                      to be selectable, or saving would silently swap them. */}
                  {task?.subcontractor_id != null &&
                    !subs.some((x) => x.id === task.subcontractor_id) && (
                      <option value={task.subcontractor_id}>
                        {task.subcontractor_name ?? `#${task.subcontractor_id}`} (inactive)
                      </option>
                    )}
                  {subs.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.trade ? ` — ${x.trade}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label">
                {subbed ? 'Our Crew Alongside (people per day)' : 'Crew Needed (people per day)'}
              </label>
              <input
                className="input"
                type="number"
                min={subbed ? 0 : 1}
                value={crewSize}
                onChange={(e) => setCrewSize(e.target.value)}
              />
            </div>
          </div>

          <p className="mt-2 text-xs text-brand-gray">
            {subbed ? (
              <>
                {sub?.name ?? 'The subcontractor'} is on site every working day of this phase —
                their dates follow it, so nothing needs re-booking when it moves.{' '}
                {crew === 0
                  ? 'None of our crew is booked on it.'
                  : `The ${crew} of ours alongside them ${crew === 1 ? 'is' : 'are'} booked in the crew week.`}
              </>
            ) : (
              'Pick how many people a day this takes — who they are is booked in the crew week.'
            )}
          </p>
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
            {subbed && (
              <p className="mt-1 font-medium text-brand-ink">
                {sub?.name ?? task?.subcontractor_name ?? 'The subcontractor'} on site all{' '}
                {workingDays} working {workingDays === 1 ? 'day' : 'days'}
              </p>
            )}
            {capacity > 0 ? (
              <p className="mt-1 font-medium text-brand-ink">
                {subbed && 'Plus '}
                {crew} of ours a day × {workingDays} working{' '}
                {workingDays === 1 ? 'day' : 'days'} = {capacity} crew{' '}
                {capacity === 1 ? 'day' : 'days'} to fill in the crew week
              </p>
            ) : (
              !subbed && (
                <p className="mt-1 font-medium text-brand-ink">Nobody booked on this phase yet</p>
              )
            )}
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

        {/* Who has actually worked this phase, and on which days. The timeline
            plans a headcount; this is the answer to "who was on it" without
            leaving the phase you're editing. */}
        {task && (
          <PhaseCrewSynopsis
            task={task}
            window={preview}
            calendar={calendar}
            subName={sub?.name ?? task.subcontractor_name ?? null}
          />
        )}

        <p className="text-xs text-brand-gray">
          {subbed && crew === 0
            ? 'The start times and the notes this crew reads are set on the phase\u2019s card in the '
            : 'Which of our people work this phase, what time everyone starts and the notes they read are all set on its card in the '}
          <span className="font-medium text-brand-ink">Crew Week</span> — a week at a time, against
          the days themselves.
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

/** "Mon Aug 17" — a day of the phase, as the synopsis lists it. */
function dayLabel(day: string): string {
  const d = fromDay(day);
  return `${DAY_LABELS[d.getDay()]} ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/** "Aug 17–20" / "Aug 17" — one run of days a person worked. */
function segmentLabel(start: string, end: string): string {
  const from = fromDay(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (start === end) return from;
  const to = fromDay(end);
  const sameMonth = fromDay(start).getMonth() === to.getMonth();
  return `${from}\u2013${
    sameMonth ? to.getDate() : to.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }`;
}

/**
 * A synopsis of the days this phase has actually been worked, and by whom.
 *
 * The phase editor plans a headcount; the crew week spends it. Coming back to a
 * phase, the first question is usually "who has been on this, and when" — so
 * the answer sits here rather than being a trip to another view. Every day
 * shown is a day somebody was really booked on, in the order they happened,
 * with the people on each of them.
 *
 * Days the phase would no longer cover after the edit being made are called out
 * rather than hidden: they're the crew days about to be dropped, and seeing
 * whose they are is the point.
 */
function PhaseCrewSynopsis({
  task,
  window,
  calendar,
  subName,
}: {
  task: ScheduleTaskRow;
  /** The window as this edit would leave it, for flagging days it drops. */
  window: ComputedWindow | null;
  calendar: WorkCalendar;
  /** The sub covering the phase, when one does. */
  subName: string | null;
}) {
  const roster = useMemo(
    () =>
      crewRoster(task).map((r) => ({
        ...r,
        // Their own days, merged into the runs they actually worked.
        segments: mergeDays(
          (task.crew_days ?? [])
            .filter((c) => c.kind === r.kind && c.ref_id === r.refId)
            .map((c) => c.day)
            .sort()
        ),
        detail: (task.crew_days ?? []).find((c) => c.kind === r.kind && c.ref_id === r.refId)?.detail,
      })),
    [task]
  );

  const days = useMemo(() => {
    const byDay = new Map<string, string[]>();
    for (const c of task.crew_days ?? []) {
      const list = byDay.get(c.day);
      if (list) list.push(c.name);
      else byDay.set(c.day, [c.name]);
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([day, names]) => ({ day, names: [...names].sort((a, b) => a.localeCompare(b)) }));
  }, [task]);

  const crewDays = (task.crew_days ?? []).length;

  return (
    <div className="rounded-lg border border-black/10 px-4 py-3 text-sm">
      <p className="font-semibold text-brand-ink">Crew on this phase so far</p>

      {subName && (
        <p className="mt-0.5 text-brand-gray">
          {subName} holds the phase — on site every working day of it, following its dates.
        </p>
      )}

      {crewDays === 0 ? (
        <p className="mt-0.5 text-brand-gray">
          {subName
            ? 'None of our people have been booked alongside them yet.'
            : 'Nobody has been booked on this phase yet — staff it in the Crew Week.'}
        </p>
      ) : (
        <>
          <p className="mt-0.5 text-brand-gray">
            {crewDays} crew {crewDays === 1 ? 'day' : 'days'} booked over {days.length}{' '}
            {days.length === 1 ? 'day' : 'days'} · {roster.length}{' '}
            {roster.length === 1 ? 'person' : 'people'}
          </p>

          <ul className="mt-2 space-y-0.5">
            {roster.map((r) => (
              <li key={r.key} className="text-brand-ink">
                <span className="font-medium">{r.name}</span>
                {r.detail && <span className="text-brand-gray"> — {r.detail}</span>}
                <span className="text-brand-gray">
                  {' '}
                  · {r.days} {r.days === 1 ? 'day' : 'days'} (
                  {r.segments.map((seg) => segmentLabel(seg.start, seg.end)).join(', ')})
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">
            Day by day
          </p>
          <ul className="mt-0.5 max-h-40 space-y-0.5 overflow-y-auto pr-1 text-xs">
            {days.map(({ day, names }) => {
              // A day the edit in progress would push outside the phase.
              const dropped = !!window && (day < window.start || day > window.end);
              const off = !isWorkingDay(day, calendar);
              return (
                <li key={day} className={dropped ? 'text-amber-700' : 'text-brand-ink'}>
                  <span className="font-medium">{dayLabel(day)}</span>
                  {off && <span className="text-brand-gray"> (weekend/holiday)</span>}
                  <span className="text-brand-gray"> — {names.join(', ')}</span>
                  {dropped && <span className="font-medium"> · outside the new dates</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
