'use client';

import { useState, useTransition } from 'react';
import { Modal } from './Modal';
import {
  addTimeEntryAction,
  updateTimeEntryAction,
  deleteTimeEntryAction,
} from '@/app/actions/time';

const GENERAL = 'general';

export interface ProjectOption {
  id: number;
  name: string;
  customer: string;
}

export interface UserOption {
  id: number;
  name: string;
}

/** Values used to prefill the form when editing an existing entry. */
export interface TimeEntryInit {
  id: number;
  projectId: number | null;
  clockIn: string; // ISO
  clockOut: string | null; // ISO
  note: string | null;
  breakMinutes: number;
}

/** ISO timestamp -> value for a <input type="datetime-local"> (local wall time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

/** A sensible default clock-in/out for a brand-new manual entry: today, 8–4. */
function defaultTimes(): { start: string; end: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return { start: `${day}T08:00`, end: `${day}T16:00` };
}

export function TimeEntryModal({
  open,
  onClose,
  onSaved,
  projects,
  users,
  entry,
  defaultUserId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  projects: ProjectOption[];
  /** When provided, the form shows an employee picker (manager add mode). */
  users?: UserOption[];
  /** When provided, the form edits this entry instead of adding a new one. */
  entry?: TimeEntryInit;
  defaultUserId?: number;
}) {
  const isEdit = !!entry;
  const def = defaultTimes();

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>(
    entry ? '' : String(defaultUserId ?? users?.[0]?.id ?? '')
  );
  const [project, setProject] = useState<string>(
    entry?.projectId ? String(entry.projectId) : GENERAL
  );
  const [clockIn, setClockIn] = useState<string>(
    entry ? toLocalInput(entry.clockIn) : def.start
  );
  const [clockOut, setClockOut] = useState<string>(
    entry ? toLocalInput(entry.clockOut) : def.end
  );
  const [breakMin, setBreakMin] = useState<string>(
    entry ? String(entry.breakMinutes || 0) : '0'
  );
  const [note, setNote] = useState<string>(entry?.note ?? '');

  function save() {
    setError(null);
    if (!clockIn || !clockOut) {
      setError('Enter a clock-in and clock-out time.');
      return;
    }
    const inIso = new Date(clockIn).toISOString();
    const outIso = new Date(clockOut).toISOString();
    if (new Date(outIso).getTime() <= new Date(inIso).getTime()) {
      setError('Clock-out must be after clock-in.');
      return;
    }
    const payload = {
      projectId: project === GENERAL ? null : Number(project),
      clockIn: inIso,
      clockOut: outIso,
      note: note.trim() || null,
      breakMinutes: Math.max(0, Number(breakMin) || 0),
    };

    start(async () => {
      const res = isEdit
        ? await updateTimeEntryAction({ ...payload, entryId: entry!.id })
        : await addTimeEntryAction({
            ...payload,
            userId: users ? Number(userId) : undefined,
          });
      if (!res.ok) {
        setError(res.error ?? 'Could not save the time entry.');
        return;
      }
      onSaved();
      onClose();
    });
  }

  function remove() {
    if (!entry) return;
    if (!confirm('Delete this time entry? This cannot be undone.')) return;
    setError(null);
    start(async () => {
      const res = await deleteTimeEntryAction(entry.id);
      if (!res.ok) {
        setError(res.error ?? 'Could not delete the time entry.');
        return;
      }
      onSaved();
      onClose();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit time entry' : 'Add past time'}>
      <div className="space-y-4">
        {users && !isEdit && (
          <div>
            <label className="label">Employee</label>
            <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
              {users.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="label">Job (optional)</label>
          <select className="input" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value={GENERAL}>General — no specific job</option>
            {projects.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.customer} — {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Clock in</label>
            <input
              type="datetime-local"
              className="input"
              value={clockIn}
              onChange={(e) => setClockIn(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Clock out</label>
            <input
              type="datetime-local"
              className="input"
              value={clockOut}
              onChange={(e) => setClockOut(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label">Lunch / break (minutes)</label>
          <input
            type="number"
            min={0}
            step={5}
            className="input"
            value={breakMin}
            onChange={(e) => setBreakMin(e.target.value)}
          />
          <p className="mt-1 text-xs text-brand-gray">Break time is subtracted from the shift total.</p>
        </div>

        <div>
          <label className="label">Note (optional)</label>
          <input
            className="input"
            placeholder="What was worked on?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex items-center justify-between gap-3 pt-1">
          {isEdit ? (
            <button
              type="button"
              className="text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
              onClick={remove}
              disabled={pending}
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-3">
            <button
              type="button"
              className="rounded-lg border border-black/10 px-4 py-2 text-sm font-semibold text-brand-gray hover:bg-black/5 disabled:opacity-50"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </button>
            <button type="button" className="btn-primary px-5 py-2 text-sm" onClick={save} disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add time'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
