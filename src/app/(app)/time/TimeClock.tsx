'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  clockInAction,
  clockOutAction,
  startBreakAction,
  endBreakAction,
} from '@/app/actions/time';
import { duration } from '@/lib/format';

interface ActiveInfo {
  id: number;
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

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

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
    run(() => clockOutAction(note), 'Could not clock out.', () => setNote(''));
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
                <input
                  className="input mt-4"
                  placeholder="What did you work on? (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button className="btn-primary mt-3 w-full py-3 text-base" onClick={clockOut} disabled={pending}>
                  {pending ? '…' : 'Clock Out'}
                </button>
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
