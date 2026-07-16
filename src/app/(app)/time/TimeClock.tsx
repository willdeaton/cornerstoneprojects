'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clockInAction, clockOutAction } from '@/app/actions/time';
import { duration } from '@/lib/format';

interface ActiveInfo {
  id: number;
  projectName: string;
  customer: string;
  clockIn: string;
}

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
  const [selected, setSelected] = useState<number | ''>(projects[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  function clockIn() {
    if (selected === '') return;
    setError(null);
    start(async () => {
      const res = await clockInAction(Number(selected));
      if (!res.ok) setError(res.error ?? 'Could not clock in.');
      router.refresh();
    });
  }

  function clockOut() {
    setError(null);
    start(async () => {
      const res = await clockOutAction(note);
      if (!res.ok) setError(res.error ?? 'Could not clock out.');
      setNote('');
      router.refresh();
    });
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
            <div className="rounded-xl border border-brand-green/40 bg-brand-green/10 p-5 text-center">
              <p className="flex items-center justify-center gap-2 text-sm font-semibold text-brand-green-dark">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand-green" /> Clocked In
              </p>
              <p className="mt-3 text-4xl font-bold tabular-nums text-brand-ink">
                {duration(active.clockIn, null)}
              </p>
              <p className="mt-2 font-medium text-brand-ink">{active.projectName}</p>
              <p className="text-sm text-brand-gray">{active.customer}</p>
            </div>
            <input
              className="input mt-4"
              placeholder="What did you work on? (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button className="btn-primary mt-3 w-full py-3 text-base" onClick={clockOut} disabled={pending}>
              {pending ? '…' : 'Clock Out'}
            </button>
          </div>
        ) : (
          <div>
            <label className="label">Choose a job</label>
            {projects.length === 0 ? (
              <p className="rounded-lg bg-black/[0.03] px-3 py-4 text-center text-sm text-brand-gray">
                No active jobs to clock into. Add a project first.
              </p>
            ) : (
              <>
                <select
                  className="input"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value === '' ? '' : Number(e.target.value))}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.customer} — {p.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn-primary mt-4 w-full py-3 text-base"
                  onClick={clockIn}
                  disabled={pending || selected === ''}
                >
                  {pending ? '…' : 'Clock In'}
                </button>
              </>
            )}
          </div>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
