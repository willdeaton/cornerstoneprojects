'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { isoDate, runBackup } from './settings/backup/run-backup';

/**
 * Monthly nudge for admins to pull a data backup. From the first Monday of the
 * month onward it shows on each visit until the admin either backs up or
 * dismisses it — the dismissal is remembered (per browser) for that month, so
 * it reappears next month automatically.
 *
 * The backup covers the *prior* calendar month (which has just closed) and can
 * be downloaded straight from the reminder — no trip to Settings required.
 */

const DISMISS_KEY = 'backup-reminder-dismissed';

type Phase = 'idle' | 'working' | 'done' | 'error';

/** Day-of-month (1-31) of the first Monday of the month containing `d`. */
function firstMondayDate(d: Date): number {
  const firstDow = new Date(d.getFullYear(), d.getMonth(), 1).getDay(); // 0 Sun … 6 Sat
  return 1 + ((1 - firstDow + 7) % 7);
}

/** Stable key for "this month", e.g. "2026-6" (July). */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

/** First day, last day and label of the calendar month before `d`. */
function priorMonthRange(d: Date): { from: string; to: string; label: string } {
  const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const last = new Date(d.getFullYear(), d.getMonth(), 0); // day 0 of this month = last day of prior
  return {
    from: isoDate(first),
    to: isoDate(last),
    label: first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  };
}

export function BackupReminder({ isAdmin }: { isAdmin: boolean }) {
  // Start closed and decide on the client only — the reminder depends on the
  // current date and localStorage, so rendering it during SSR would risk a
  // hydration mismatch.
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<{ from: string; to: string; label: string } | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    const now = new Date();
    if (now.getDate() < firstMondayDate(now)) return; // not yet the first Monday
    if (localStorage.getItem(DISMISS_KEY) === monthKey(now)) return; // dismissed this month
    setRange(priorMonthRange(now));
    setOpen(true);
  }, [isAdmin]);

  function dismissForMonth() {
    localStorage.setItem(DISMISS_KEY, monthKey(new Date()));
    setOpen(false);
  }

  async function backUpNow() {
    if (!range || phase === 'working') return;
    setError(null);
    setPhase('working');
    try {
      const summary = await runBackup(range.from, range.to, setMessage);
      setPhase('done');
      setMessage(summary);
      // A completed backup counts as done for the month, so it won't nag again.
      localStorage.setItem(DISMISS_KEY, monthKey(new Date()));
    } catch (e) {
      setPhase('error');
      setError(e instanceof Error ? e.message : 'Something went wrong building the backup.');
    }
  }

  const busy = phase === 'working';

  // The X / backdrop is a soft close: it hides the reminder for now but doesn't
  // record it, so it comes back on the next visit until explicitly dismissed.
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) setOpen(false);
      }}
      title="Monthly backup reminder"
    >
      <div className="space-y-4">
        {phase === 'done' ? (
          <p className="text-sm text-brand-gray">{message}</p>
        ) : (
          <p className="text-sm text-brand-gray">
            It&apos;s time for your <strong className="text-brand-ink">{range?.label}</strong> data
            backup — the first Monday of the month. Download a ZIP of that month&apos;s quotes,
            projects and time for your records, including a PDF of every quote.
          </p>
        )}

        {busy && message && <p className="text-sm text-brand-gray">{message}</p>}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {phase === 'done' ? (
            <button className="btn-primary" onClick={() => setOpen(false)}>
              Done
            </button>
          ) : (
            <>
              <button className="btn-secondary" onClick={dismissForMonth} disabled={busy}>
                Remind me next month
              </button>
              <button className="btn-primary" onClick={backUpNow} disabled={busy}>
                {busy ? 'Preparing…' : `Back up ${range?.label ?? 'now'}`}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
