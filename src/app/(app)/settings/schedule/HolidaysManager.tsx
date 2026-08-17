'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { shortDate } from '@/lib/format';
import { saveHolidayAction, deleteHolidayAction } from '@/app/actions/schedule';

export function HolidaysManager({
  holidays,
}: {
  holidays: { day: string; label: string | null }[];
}) {
  const router = useRouter();
  const [day, setDay] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function add() {
    setError(null);
    start(async () => {
      const res = await saveHolidayAction(day, label);
      if (!res.ok) {
        setError(res.error ?? 'Could not save.');
        return;
      }
      setDay('');
      setLabel('');
      router.refresh();
    });
  }

  function remove(d: string) {
    start(async () => {
      await deleteHolidayAction(d);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:w-48">
            <label className="label">Date</label>
            <input
              className="input"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="label">Label</label>
            <input
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Thanksgiving"
            />
          </div>
          <button className="btn-primary" onClick={add} disabled={pending || !day}>
            Add
          </button>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>

      {holidays.length === 0 ? (
        <div className="card p-8 text-center text-sm text-brand-gray">
          No non-working days yet. Weekends are always skipped.
        </div>
      ) : (
        <div className="card divide-y divide-black/5">
          {holidays.map((h) => (
            <div key={h.day} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-brand-ink">{shortDate(h.day)}</p>
                {h.label && <p className="text-sm text-brand-gray">{h.label}</p>}
              </div>
              <button
                className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                onClick={() => remove(h.day)}
                disabled={pending}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
