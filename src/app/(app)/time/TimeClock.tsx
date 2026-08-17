'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  clockInAction,
  clockOutAction,
  switchJobAction,
  startBreakAction,
  endBreakAction,
} from '@/app/actions/time';
import { duration } from '@/lib/format';
import { isValidSynopsis, SYNOPSIS_ERROR } from '@/lib/synopsis';

interface ActiveInfo {
  id: number;
  projectId: number | null;
  projectName: string | null;
  customer: string | null;
  clockIn: string;
  onBreak: boolean;
  breakStart: string | null;
}

const GENERAL = 'general';

export function TimeClock({
  userName,
  active,
  projects,
  weekHours,
}: {
  userName: string;
  active: ActiveInfo | null;
  projects: { id: number; name: string; customer: string }[];
  weekHours: number;
}) {
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string>(GENERAL);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const router = useRouter();

  // The value of the job <select> shown while clocked in: the current job
  // stays selected by default, so "Switch job" is disabled until the worker
  // picks a different one.
  const currentJob = active ? (active.projectId === null ? GENERAL : String(active.projectId)) : GENERAL;
  const [switchTo, setSwitchTo] = useState<string>(currentJob);
  const [switchNote, setSwitchNote] = useState('');

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  // Re-anchor the switch selector whenever the active shift changes (after a
  // clock-in or a job switch), so it always defaults to the current job.
  useEffect(() => {
    setSwitchTo(currentJob);
  }, [active?.id, currentJob]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, fallback: string, after?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? fallback);
      else after?.();
      router.refresh();
    });
  }

  function clockIn() {
    const projectId = selected === GENERAL ? null : Number(selected);
    run(() => clockInAction(projectId), 'Could not clock in.');
  }

  function clockOut() {
    // Mirror the server-side rule: a real synopsis is required to clock out.
    if (!isValidSynopsis(note)) {
      setError(SYNOPSIS_ERROR);
      return;
    }
    run(() => clockOutAction(note), 'Could not clock out.', () => setNote(''));
  }

  function switchJob() {
    const projectId = switchTo === GENERAL ? null : Number(switchTo);
    run(() => switchJobAction(projectId, switchNote), 'Could not switch jobs.', () => setSwitchNote(''));
  }

  return (
    <div className="card overflow-hidden">
      <div className="bg-brand-ink px-6 py-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/60">Signed in as</p>
            <p className="brand-heading text-xl">{userName}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-white/60">This week</p>
            <p className="text-xl font-bold text-brand-green">{weekHours.toFixed(1)}h</p>
          </div>
        </div>
      </div>

      <div className="p-6">
        {active ? (
          <div>
            <div
              className={`rounded-xl border p-5 text-center ${
                active.onBreak
                  ? 'border-status-progress/40 bg-status-progress/10'
                  : 'border-brand-green/40 bg-brand-green/10'
              }`}
            >
              {active.onBreak ? (
                <>
                  <p className="flex items-center justify-center gap-2 text-sm font-semibold text-amber-700">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-status-progress" /> On Lunch Break
                  </p>
                  <p className="mt-3 text-4xl font-bold tabular-nums text-brand-ink">
                    {duration(active.breakStart ?? active.clockIn, null)}
                  </p>
                  <p className="mt-2 text-sm text-brand-gray">Break time isn&apos;t counted toward your hours.</p>
                </>
              ) : (
                <>
                  <p className="flex items-center justify-center gap-2 text-sm font-semibold text-brand-green-dark">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand-green" /> Clocked In
                  </p>
                  <p className="mt-3 text-4xl font-bold tabular-nums text-brand-ink">
                    {duration(active.clockIn, null)}
                  </p>
                  <p className="mt-2 font-medium text-brand-ink">
                    {active.projectName ?? 'General (no specific job)'}
                  </p>
                  {active.customer && <p className="text-sm text-brand-gray">{active.customer}</p>}
                </>
              )}
            </div>

            {/* Lunch break controls */}
            {active.onBreak ? (
              <button
                className="btn-primary mt-4 w-full py-3 text-base"
                onClick={() => run(endBreakAction, 'Could not end break.')}
                disabled={pending}
              >
                {pending ? '…' : 'End Lunch Break'}
              </button>
            ) : (
              <>
                <button
                  className="mt-4 w-full rounded-lg border border-status-progress/50 bg-status-progress/10 py-3 text-base font-semibold text-amber-700 transition hover:bg-status-progress/20 disabled:opacity-50"
                  onClick={() => run(startBreakAction, 'Could not start break.')}
                  disabled={pending}
                >
                  {pending ? '…' : 'Start Lunch Break'}
                </button>
                {/* Mid-day job switch: closes this segment and keeps the
                    clock running on the new job. */}
                <div className="mt-5 border-t border-gray-100 pt-4">
                  <label className="label">Switch to a different job</label>
                  <select
                    className="input"
                    value={switchTo}
                    onChange={(e) => setSwitchTo(e.target.value)}
                  >
                    <option value={GENERAL}>
                      General — no specific job{currentJob === GENERAL ? ' (current)' : ''}
                    </option>
                    {active.projectId !== null && !projects.some((p) => p.id === active.projectId) && (
                      <option value={String(active.projectId)}>
                        {active.customer ? `${active.customer} — ` : ''}
                        {active.projectName ?? 'Current job'} (current)
                      </option>
                    )}
                    {projects.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.customer} — {p.name}
                        {String(p.id) === currentJob ? ' (current)' : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input mt-3"
                    placeholder="What did you do on this job? (optional)"
                    value={switchNote}
                    onChange={(e) => setSwitchNote(e.target.value)}
                  />
                  <button
                    className="mt-3 w-full rounded-lg border border-brand-green/50 bg-brand-green/10 py-3 text-base font-semibold text-brand-green-dark transition hover:bg-brand-green/20 disabled:opacity-50"
                    onClick={switchJob}
                    disabled={pending || switchTo === currentJob}
                  >
                    {pending ? '…' : 'Switch Job'}
                  </button>
                </div>

                {/* Clock out — a shift synopsis is required. */}
                <div className="mt-5 border-t border-gray-100 pt-4">
                  <label className="label">Shift synopsis — what did you work on? (required)</label>
                  <input
                    className="input"
                    placeholder="e.g. Painted the back hallway and prepped trim"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button className="btn-primary mt-3 w-full py-3 text-base" onClick={clockOut} disabled={pending}>
                    {pending ? '…' : 'Clock Out'}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div>
            <label className="label">Choose a job (optional)</label>
            <select
              className="input"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value={GENERAL}>General — no specific job</option>
              {projects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.customer} — {p.name}
                </option>
              ))}
            </select>
            <button
              className="btn-primary mt-4 w-full py-3 text-base"
              onClick={clockIn}
              disabled={pending}
            >
              {pending ? '…' : 'Clock In'}
            </button>
          </div>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
