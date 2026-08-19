'use client';

import { useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { shortDate } from '@/lib/format';
import {
  DAY_INITIALS,
  DAY_LABELS,
  DAY_MASK_WEEKDAYS,
  computeSchedule,
  eachDay,
  fromDay,
  isSplitPattern,
  isWorkingDay,
  maskDows,
  maskLabel,
  normalizeMask,
  timeLabel,
  today,
  toggleDow,
  workedSegments,
  workingDaySpan,
} from '@/lib/schedule-math';
import { diffTask, movesTimeline, needsReason, summarizeChanges } from '@/lib/schedule-diff';
import type { DependsType, ScheduleTaskRow, TaskDayTime, TaskStatus } from '@/lib/types';
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

/** 'user:4' / 'sub:2' — the same key the conflict finder groups by. */
type AssigneeKey = string;
/** Who's on the phase, and which weekdays each of them works it (null = all). */
type Crew = Map<AssigneeKey, number | null>;

/**
 * Create or edit one phase of work. The dates shown under the duration field are
 * the real computed ones — this runs the same solver the timeline does, so a
 * phase that follows another shows where it actually lands before you save.
 *
 * Beyond plain dates:
 *  · each person can be booked on only some weekdays (split days), so an
 *    employee can run this job Mon/Wed and be free elsewhere Tuesday;
 *  · the crew can be given a daily start time, with a different time on any
 *    individual day (an early delivery, a late inspection);
 *  · moving the dates always requires a reason, and once the job's schedule is
 *    published so does moving people — the exact wording that gets logged is
 *    previewed before you commit.
 */
export function TaskModal({
  task,
  allTasks,
  projects,
  workers,
  subs,
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
  workers: WorkerOption[];
  subs: SubOption[];
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
  const [dependsOn, setDependsOn] = useState<number | null>(task?.depends_on_id ?? null);
  const [dependsType, setDependsType] = useState<DependsType>(
    task?.depends_type ?? 'finish_to_start'
  );
  const [lag, setLag] = useState(String(task?.lag_days ?? 0));
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'not_started');
  const [startTime, setStartTime] = useState(task?.start_time ?? '');
  // Presence in the map is an override for that day; a null value is an
  // override that says "no set time on this day".
  const [dayTimes, setDayTimes] = useState<Map<string, string | null>>(
    () => new Map((task?.day_times ?? []).map((d) => [d.day, d.start_time]))
  );
  const [showDayTimes, setShowDayTimes] = useState(
    () => (task?.day_times ?? []).length > 0
  );
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [crew, setCrew] = useState<Crew>(
    () => new Map((task?.assignees ?? []).map((a) => [`${a.kind}:${a.ref_id}`, a.work_days]))
  );
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

  const draftAssignees = useMemo(
    () =>
      [...crew.entries()].map(([key, workDays]) => {
        const [kind, id] = key.split(':');
        // Normalized here so the change preview matches what the server records.
        return {
          kind: kind as 'user' | 'sub',
          ref_id: Number(id),
          work_days: normalizeMask(workDays),
        };
      }),
    [crew]
  );

  const draftStartTime = startTime.trim() === '' ? null : startTime.trim();

  // Run the solver over the job as it would be after this edit, so the preview
  // reflects the real chain rather than just the typed start date.
  const preview = useMemo(() => {
    const durationDays = Math.max(1, Math.round(Number(duration) || 1));
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
  }, [allTasks, projectId, task?.id, startDate, duration, lag, dependsOn, dependsType, calendar]);

  // The phase's own working days, which is what a per-day time can be set on.
  // Split-day patterns don't narrow this: a time belongs to the day of work, and
  // whoever is on that day starts then.
  const workingDays = useMemo(() => {
    if (!preview) return [];
    return eachDay(preview.start, preview.end).filter((d) => isWorkingDay(d, calendar));
  }, [preview, calendar]);

  /**
   * The overrides worth saving: days that are still inside the phase's window.
   * A phase that shrinks or moves drops the times for days it no longer covers,
   * so a stale 6 AM never lingers on a day nobody works.
   */
  const draftDayTimes = useMemo<TaskDayTime[]>(() => {
    const inWindow = new Set(workingDays);
    return [...dayTimes.entries()]
      .filter(([day]) => inWindow.has(day))
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([day, start_time]) => ({ day, start_time }));
  }, [dayTimes, workingDays]);

  // The wording that gets logged, and whether a reason is required at all: an
  // edit that only marks progress doesn't need one, even on a published job.
  const changes = useMemo(() => {
    if (!task) return null;
    const names = {
      phase: (id: number) => allTasks.find((t) => t.id === id)?.name ?? 'a deleted phase',
      // The pickers only list active people, so fall back to the names already
      // on the phase — otherwise a deactivated employee reads as a crew change.
      person: (kind: 'user' | 'sub', refId: number) =>
        (kind === 'user' ? workers.find((w) => w.id === refId) : subs.find((s) => s.id === refId))
          ?.name ??
        task.assignees?.find((a) => a.kind === kind && a.ref_id === refId)?.name ??
        `#${refId}`,
    };
    return diffTask(
      {
        name: task.name,
        start_date: task.start_date,
        duration_days: task.duration_days,
        depends_on_id: task.depends_on_id,
        depends_type: task.depends_type ?? 'finish_to_start',
        lag_days: task.lag_days,
        start_time: task.start_time ?? null,
        day_times: task.day_times ?? [],
        notes: task.notes,
        status: task.status,
        assignees: task.assignees ?? [],
      },
      {
        name: name.trim(),
        start_date: startDate,
        duration_days: Math.max(1, Math.round(Number(duration) || 1)),
        depends_on_id: dependsOn,
        depends_type: dependsType,
        lag_days: Math.max(0, Math.round(Number(lag) || 0)),
        start_time: draftStartTime,
        day_times: draftDayTimes,
        notes: notes.trim() === '' ? null : notes.trim(),
        status,
        assignees: draftAssignees,
      },
      names
    );
  }, [
    task,
    allTasks,
    workers,
    subs,
    name,
    startDate,
    duration,
    dependsOn,
    dependsType,
    lag,
    draftStartTime,
    draftDayTimes,
    notes,
    status,
    draftAssignees,
  ]);

  // Moving the dates always needs explaining; moving people needs it once the
  // crew has the schedule. A new phase only needs it on a published job.
  const reasonRequired = task
    ? !!changes && needsReason(changes, publishedVersion != null)
    : publishedVersion != null;
  const timelineMoved = !!changes && movesTimeline(changes);

  function toggle(key: AssigneeKey) {
    setCrew((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, null);
      return next;
    });
  }

  /** Flip one weekday for one person, switching them onto a split pattern. */
  function toggleDay(key: AssigneeKey, dow: number) {
    setCrew((prev) => {
      const next = new Map(prev);
      const current = next.get(key);
      // Someone on "every working day" starts from Mon–Fri, so the first click
      // removes a day rather than leaving them booked on one day only.
      const base = current ?? DAY_MASK_WEEKDAYS;
      const flipped = toggleDow(base, dow);
      next.set(key, flipped === 0 ? null : flipped);
      return next;
    });
  }

  function clearDays(key: AssigneeKey) {
    setCrew((prev) => new Map(prev).set(key, null));
  }

  /** Give one day its own start time; an empty value means "no time that day". */
  function setDayTime(day: string, value: string) {
    setDayTimes((prev) => new Map(prev).set(day, value.trim() === '' ? null : value.trim()));
  }

  /** Drop a day's override so it follows the phase's daily start time again. */
  function clearDayTime(day: string) {
    setDayTimes((prev) => {
      const next = new Map(prev);
      next.delete(day);
      return next;
    });
  }

  async function submit() {
    setError(null);
    setSaving(true);
    const res = await saveTaskAction({
      id: task?.id,
      project_id: projectId,
      name,
      start_date: startDate,
      duration_days: Math.max(1, Math.round(Number(duration) || 1)),
      depends_on_id: dependsOn,
      depends_type: dependsType,
      lag_days: Math.max(0, Math.round(Number(lag) || 0)),
      status,
      start_time: draftStartTime,
      day_times: draftDayTimes,
      notes,
      assignees: draftAssignees,
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
  const splitCrew = [...crew.entries()].filter(([, mask]) => isSplitPattern(mask));

  return (
    <Modal open onClose={onClose} title={task ? 'Edit Phase' : 'Schedule Work'} wide>
      <div className="space-y-4">
        {publishedVersion != null ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-semibold">Published schedule (v{publishedVersion})</p>
            <p>
              The crew has these dates. Any change to the dates, duration, links, start times or
              crew needs a reason, which is saved to this job&apos;s change history.
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

        {/* Live result of the dependency chain, weekends and holidays included. */}
        {preview && (
          <div className="rounded-lg border border-black/10 bg-black/[.02] px-4 py-3 text-sm">
            <p className="font-semibold text-brand-ink">
              {shortDate(preview.start)} → {shortDate(preview.end)}
            </p>
            <p className="mt-0.5 text-brand-gray">
              {workingDaySpan(preview.start, preview.end, calendar)} working days
              {preview.driven && ' · pushed out by the phase it follows'}
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

        {/* Daily start times. The phase time covers every day; any single day
            can be given its own, for the 6 AM delivery or the late inspection. */}
        <div className="rounded-lg border border-black/10 p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <label className="label">Daily Start Time</label>
              <input
                className="input w-40"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
              <p className="mt-1 text-xs text-brand-gray">
                {draftStartTime
                  ? `The crew starts at ${timeLabel(draftStartTime)} each day of this phase.`
                  : 'Leave empty and the crew works their normal hours.'}
              </p>
            </div>
            {workingDays.length > 0 && (
              <button
                type="button"
                className="text-sm font-medium text-brand-green-dark hover:underline"
                onClick={() => setShowDayTimes((v) => !v)}
              >
                {showDayTimes ? 'Hide day-by-day times' : 'Set a different time on some days'}
                {draftDayTimes.length > 0 && ` (${draftDayTimes.length})`}
              </button>
            )}
          </div>

          {showDayTimes && workingDays.length > 0 && (
            <div className="mt-3 max-h-56 space-y-1 overflow-y-auto border-t border-black/5 pt-3">
              {workingDays.map((day) => {
                const overridden = dayTimes.has(day);
                const value = overridden ? dayTimes.get(day) ?? '' : '';
                return (
                  <div key={day} className="flex items-center gap-2 text-sm">
                    <span className="w-32 shrink-0 text-brand-ink">
                      {fromDay(day).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <input
                      className="input w-32"
                      type="time"
                      value={value}
                      // A blank box on a day that already has an override means
                      // "no set time that day", which is how one day opts out.
                      onChange={(e) => setDayTime(day, e.target.value)}
                    />
                    {overridden ? (
                      <button
                        type="button"
                        className="text-xs font-medium text-brand-green-dark hover:underline"
                        onClick={() => clearDayTime(day)}
                        title="Follow the phase's daily start time again"
                      >
                        {value === '' ? 'no set time · use phase time' : 'use phase time'}
                      </button>
                    ) : (
                      <span className="text-xs text-brand-gray">
                        {draftStartTime ? timeLabel(draftStartTime) : 'no set time'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="label">Who&apos;s On It</label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <AssigneePicker
              heading="Employees"
              empty="No active employees."
              options={workers.map((w) => ({ key: `user:${w.id}`, name: w.name, detail: w.role }))}
              crew={crew}
              onToggle={toggle}
              onToggleDay={toggleDay}
              onClearDays={clearDays}
            />
            <AssigneePicker
              heading="Subcontractors"
              empty="No subs yet — add them under Settings → Subcontractors."
              options={subs.map((s) => ({ key: `sub:${s.id}`, name: s.name, detail: s.trade }))}
              crew={crew}
              onToggle={toggle}
              onToggleDay={toggleDay}
              onClearDays={clearDays}
            />
          </div>
          <p className="mt-2 text-xs text-brand-gray">
            Everyone works every working day of the phase unless you pick days for them. Use the day
            buttons to split someone across jobs — Mon/Wed here, Tuesday somewhere else. Only the
            days they share with another job count as a double-booking.
          </p>
          {splitCrew.length > 0 && (
            <p className="mt-1 text-xs font-medium text-brand-green-dark">
              Split days:{' '}
              {splitCrew
                .map(([key, mask]) => {
                  const [kind, id] = key.split(':');
                  const person =
                    kind === 'user'
                      ? workers.find((w) => w.id === Number(id))
                      : subs.find((s) => s.id === Number(id));
                  return `${person?.name ?? key} — ${maskLabel(mask)}`;
                })
                .join('; ')}
            </p>
          )}
        </div>

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

function AssigneePicker({
  heading,
  empty,
  options,
  crew,
  onToggle,
  onToggleDay,
  onClearDays,
}: {
  heading: string;
  empty: string;
  options: { key: string; name: string; detail: string | null }[];
  crew: Crew;
  onToggle: (key: string) => void;
  onToggleDay: (key: string, dow: number) => void;
  onClearDays: (key: string) => void;
}) {
  return (
    <div className="rounded-lg border border-black/10 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">{heading}</p>
      {options.length === 0 ? (
        <p className="text-sm text-brand-gray">{empty}</p>
      ) : (
        <div className="max-h-56 space-y-1.5 overflow-y-auto">
          {options.map((o) => {
            const picked = crew.has(o.key);
            const mask = crew.get(o.key) ?? null;
            return (
              <div key={o.key}>
                <label className="flex items-center gap-2 text-sm text-brand-ink">
                  <input type="checkbox" checked={picked} onChange={() => onToggle(o.key)} />
                  <span className="truncate">
                    {o.name}
                    {o.detail && <span className="text-brand-gray"> · {o.detail}</span>}
                  </span>
                </label>
                {picked && (
                  <div className="mt-1 flex flex-wrap items-center gap-1 pl-6">
                    <DayToggles mask={mask} onToggle={(dow) => onToggleDay(o.key, dow)} />
                    {isSplitPattern(mask) ? (
                      <button
                        className="ml-1 text-[11px] font-medium text-brand-green-dark hover:underline"
                        onClick={() => onClearDays(o.key)}
                        title="Put them back on every working day of the phase"
                      >
                        reset
                      </button>
                    ) : (
                      <span className="ml-1 text-[11px] text-brand-gray">all working days</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Mon–Sun buttons for one person's split-day pattern. */
function DayToggles({ mask, onToggle }: { mask: number | null; onToggle: (dow: number) => void }) {
  // Monday first, the way a work week reads; Sat/Sun sit at the end and are
  // only ever on if someone deliberately schedules weekend work.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const on = mask == null ? new Set(maskDows(DAY_MASK_WEEKDAYS)) : new Set(maskDows(mask));
  return (
    <span className="flex gap-0.5">
      {order.map((dow) => {
        const active = on.has(dow);
        return (
          <button
            key={dow}
            type="button"
            onClick={() => onToggle(dow)}
            title={DAY_LABELS[dow]}
            aria-label={DAY_LABELS[dow]}
            aria-pressed={active}
            className={`h-6 w-6 rounded text-[11px] font-semibold transition-colors ${
              active
                ? 'bg-brand-green text-white'
                : 'bg-black/5 text-brand-gray hover:bg-black/10'
            } ${dow === 0 || dow === 6 ? 'opacity-80' : ''}`}
          >
            {DAY_INITIALS[dow]}
          </button>
        );
      })}
    </span>
  );
}
