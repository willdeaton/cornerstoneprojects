'use client';

import type { TimeEntryWithUser } from '@/lib/data';
import { dateTime, duration } from '@/lib/format';

export function ProjectTime({
  entries,
  totalHours,
}: {
  entries: TimeEntryWithUser[];
  totalHours: number;
}) {
  const closed = entries.filter((e) => e.clock_out);
  const contributors = new Set(entries.map((e) => e.user_name)).size;

  return (
    <div className="card p-5">
      <h2 className="brand-heading mb-4 text-sm text-brand-gray">Time Worked</h2>

      <div className="mb-4 rounded-lg border border-brand-green/40 bg-brand-green/10 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">Total Logged</p>
        <p className="mt-1 text-2xl font-bold text-brand-ink">{totalHours.toFixed(1)}h</p>
        <p className="mt-0.5 text-xs text-brand-gray">
          {closed.length} {closed.length === 1 ? 'entry' : 'entries'}
          {contributors > 0
            ? ` · ${contributors} ${contributors === 1 ? 'person' : 'people'}`
            : ''}
        </p>
      </div>

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
                {e.clock_out ? duration(e.clock_in, e.clock_out) : 'In progress'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
