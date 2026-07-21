'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';

/**
 * Monthly nudge for admins to pull a data backup. From the first Monday of the
 * month onward it shows on each visit until the admin either backs up or
 * dismisses it — the dismissal is remembered (per browser) for that month, so
 * it reappears next month automatically.
 */

const DISMISS_KEY = 'backup-reminder-dismissed';

/** Day-of-month (1-31) of the first Monday of the month containing `d`. */
function firstMondayDate(d: Date): number {
  const firstDow = new Date(d.getFullYear(), d.getMonth(), 1).getDay(); // 0 Sun … 6 Sat
  return 1 + ((1 - firstDow + 7) % 7);
}

/** Stable key for "this month", e.g. "2026-6" (July). */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export function BackupReminder({ isAdmin }: { isAdmin: boolean }) {
  // Start closed and decide on the client only — the reminder depends on the
  // current date and localStorage, so rendering it during SSR would risk a
  // hydration mismatch.
  const [open, setOpen] = useState(false);
  const [monthLabel, setMonthLabel] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (!isAdmin) return;
    const now = new Date();
    if (now.getDate() < firstMondayDate(now)) return; // not yet the first Monday
    if (localStorage.getItem(DISMISS_KEY) === monthKey(now)) return; // dismissed this month
    setMonthLabel(now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
    setOpen(true);
  }, [isAdmin]);

  function dismissForMonth() {
    localStorage.setItem(DISMISS_KEY, monthKey(new Date()));
    setOpen(false);
  }

  function backUpNow() {
    dismissForMonth();
    router.push('/settings/backup');
  }

  // The X / backdrop is a soft close: it hides the reminder for now but doesn't
  // record it, so it comes back on the next visit until explicitly dismissed.
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Monthly backup reminder">
      <div className="space-y-4">
        <p className="text-sm text-brand-gray">
          It&apos;s time for your <strong className="text-brand-ink">{monthLabel}</strong> data
          backup — the first Monday of the month. Download a ZIP of your quotes, projects and time
          for your records, including a PDF of every quote.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-secondary" onClick={dismissForMonth}>
            Remind me next month
          </button>
          <button className="btn-primary" onClick={backUpNow}>
            Back up now
          </button>
        </div>
      </div>
    </Modal>
  );
}
