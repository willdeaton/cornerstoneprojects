'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { TimeEntryWithUser } from '@/lib/data';
import { dateTime, duration } from '@/lib/format';
import { clockInAction, clockOutAction } from '@/app/actions/time';

function LiveDuration({ start }: { start: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  return <>{duration(start, null)}</>;
}

export function ProjectTime({
  projectId,
  entries,
  clockedInHere,
  clockedInElsewhere,
  activeElsewhereName,
}: {
  projectId: number;
  entries: TimeEntryWithUser[];
  clockedInHere: boolean;
  clockedInElsewhere: boolean;
  activeElsewhereName: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const router = useRouter();

  function clockIn() {
    setError(null);
    start(async () => {
      const res = await clockInAction(projectId);
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
    <div className="card p-5">
      <h2 className="brand-heading mb-4 text-sm text-brand-gray">Time Clock</h2>

      {clockedInHere ? (
        <div className="mb-4 rounded-lg border border-brand-green/40 bg-brand-green/10 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-brand-green-dark">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand-green" /> You&apos;re clocked in
          </p>
          <input
            className="input mt-3"
            placeholder="What did you work on? (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="btn-primary mt-3 w-full" onClick={clockOut} disabled={pending}>
            {pending ? '…' : 'Clock Out'}
          </button>
        </div>
      ) : clockedInElsewhere ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          You&apos;re currently clocked in to <strong>{activeElsewhereName}</strong>. Clock out there first.
        </div>
      ) : (
        <button className="btn-primary mb-4 w-full" onClick={clockIn} disabled={pending}>
          {pending ? '…' : 'Clock In to This Job'}
        </button>
      )}

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">
        Recent Entries
      </h3>
      {entries.length === 0 ? (
        <p className="py-3 text-center text-sm text-brand-gray">No time logged yet.</p>
      ) : (
        <ul className="divide-y divide-black/5">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-2.5 text-sm">
              <div>
                <p className="font-medium text-brand-ink">{e.user_name}</p>
                <p className="text-xs text-brand-gray">
                  {dateTime(e.clock_in)}
                  {e.note ? ` · ${e.note}` : ''}
                </p>
              </div>
              <span
                className={`font-semibold ${e.clock_out ? 'text-brand-ink' : 'text-brand-green-dark'}`}
              >
                {e.clock_out ? duration(e.clock_in, e.clock_out) : <LiveDuration start={e.clock_in} />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
