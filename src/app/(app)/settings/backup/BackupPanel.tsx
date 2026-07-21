'use client';

import { useState } from 'react';
import { isoDate, runBackup } from './run-backup';

type Phase = 'idle' | 'working' | 'done' | 'error';

export function BackupPanel() {
  const today = new Date();
  const [from, setFrom] = useState(isoDate(new Date(today.getFullYear(), 0, 1)));
  const [to, setTo] = useState(isoDate(today));
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setError(null);
    if (from > to) {
      setError('The start date must be on or before the end date.');
      return;
    }
    setPhase('working');
    try {
      const summary = await runBackup(from, to, setMessage);
      setPhase('done');
      setMessage(summary);
    } catch (e) {
      setPhase('error');
      setError(e instanceof Error ? e.message : 'Something went wrong building the backup.');
    }
  }

  const busy = phase === 'working';

  return (
    <div className="card max-w-xl p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="backup-from">From</label>
          <input
            id="backup-from"
            type="date"
            className="input"
            value={from}
            max={to}
            disabled={busy}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="backup-to">To</label>
          <input
            id="backup-to"
            type="date"
            className="input"
            value={to}
            min={from}
            disabled={busy}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button className="btn-primary" onClick={download} disabled={busy}>
          {busy ? 'Preparing…' : 'Download backup'}
        </button>
        {phase !== 'idle' && message && (
          <p className={`text-sm ${phase === 'error' ? 'text-red-700' : 'text-brand-gray'}`}>
            {message}
          </p>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <p className="mt-4 text-xs text-brand-gray">
        Everything runs in your browser — for a wide date range with many quotes this can take a
        little while. Keep this tab open until the ZIP downloads.
      </p>
    </div>
  );
}
