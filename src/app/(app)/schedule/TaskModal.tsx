'use client';

import { useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { shortDate } from '@/lib/format';
import { computeSchedule, today, workingDaySpan } from '@/lib/schedule-math';
import type { ScheduleTaskRow, TaskStatus } from '@/lib/types';
import { TASK_STATUS_LABELS } from '@/lib/types';
import { saveTaskAction, deleteTaskAction } from '@/app/actions/schedule';

export interface ProjectOption {
  id: number;
  name: string;
  customer: string;
  due_date: string | null;
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

/**
 * Create or edit one phase of work. The dates shown under the duration field are
 * the real computed ones — this runs the same solver the timeline does, so a
 * phase that follows another shows where it actually lands before you save.
 */
export function TaskModal({
  task,
  allTasks,
  projects,
  workers,
  subs,
  holidays,
  defaultProjectId,
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
  onClose: () => void;
  onSaved: () => void;
}) {
  const [projectId, setProjectId] = useState<number>(
    task?.project_id ?? defaultProjectId ?? projects[0]?.id ?? 0
  );
  const [name, setName] = useState(task?.name ?? '');
  const [startDate, setStartDate] = useState(task?.start_date ?? today());
  const [duration, setDuration] = useState(String(task?.duration_days ?? 5));
  const [dependsOn, setDependsOn] = useState<number | null>(task?.depends_on_id ?? null);
  const [lag, setLag] = useState(String(task?.lag_days ?? 0));
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'not_started');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [picked, setPicked] = useState<Set<AssigneeKey>>(
    () => new Set((task?.assignees ?? []).map((a) => `${a.kind}:${a.ref_id}`))
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const calendar = useMemo(() => ({ holidays: new Set(holidays) }), [holidays]);
  // Opened from a job's own page, the job is fixed — phases don't move between jobs.
  const projectLocked = defaultProjectId != null;

  // Phases available as a predecessor: same job, never the phase itself.
  const predecessorOptions = useMemo(
    () => allTasks.filter((t) => t.project_id === projectId && t.id !== task?.id),
    [allTasks, projectId, task?.id]
  );

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
        lag_days: t.lag_days,
      }));
    const draft = {
      id: draftId,
      project_id: projectId,
      start_date: startDate,
      duration_days: durationDays,
      depends_on_id: dependsOn,
      lag_days: lagDays,
    };
    const { windows } = computeSchedule([...others, draft], calendar);
    return windows.get(draftId) ?? null;
  }, [allTasks, projectId, task?.id, startDate, duration, lag, dependsOn, calendar]);

  function toggle(key: AssigneeKey) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
      lag_days: Math.max(0, Math.round(Number(lag) || 0)),
      status,
      notes,
      assignees: [...picked].map((key) => {
        const [kind, id] = key.split(':');
        return { kind: kind as 'user' | 'sub', ref_id: Number(id) };
      }),
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
    setSaving(true);
    const res = await deleteTaskAction(task.id);
    if (res.ok) onSaved();
    else {
      setError(res.error ?? 'Could not delete.');
      setSaving(false);
    }
  }

  const dueDate = projects.find((p) => p.id === projectId)?.due_date ?? null;
  const pastDue = preview && dueDate ? preview.end > dueDate : false;

  return (
    <Modal open onClose={onClose} title={task ? 'Edit Phase' : 'Schedule Work'} wide>
      <div className="space-y-4">
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
            <label className="label">
              {dependsOn ? 'Earliest Start' : 'Start Date'} *
            </label>
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <label className="label">Wait After It (working days)</label>
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
            {pastDue && (
              <p className="mt-1 font-medium text-amber-700">
                Ends after this job&apos;s due date of {shortDate(dueDate)}.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="label">Who&apos;s On It</label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <AssigneePicker
              heading="Employees"
              empty="No active employees."
              options={workers.map((w) => ({ key: `user:${w.id}`, name: w.name, detail: w.role }))}
              picked={picked}
              onToggle={toggle}
            />
            <AssigneePicker
              heading="Subcontractors"
              empty="No subs yet — add them under Settings → Subcontractors."
              options={subs.map((s) => ({ key: `sub:${s.id}`, name: s.name, detail: s.trade }))}
              picked={picked}
              onToggle={toggle}
            />
          </div>
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
            <button className="btn-primary" onClick={submit} disabled={saving}>
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
  picked,
  onToggle,
}: {
  heading: string;
  empty: string;
  options: { key: string; name: string; detail: string | null }[];
  picked: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="rounded-lg border border-black/10 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">{heading}</p>
      {options.length === 0 ? (
        <p className="text-sm text-brand-gray">{empty}</p>
      ) : (
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {options.map((o) => (
            <label key={o.key} className="flex items-center gap-2 text-sm text-brand-ink">
              <input type="checkbox" checked={picked.has(o.key)} onChange={() => onToggle(o.key)} />
              <span className="truncate">
                {o.name}
                {o.detail && <span className="text-brand-gray"> · {o.detail}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
