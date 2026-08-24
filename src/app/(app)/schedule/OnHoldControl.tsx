'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { shortDate } from '@/lib/format';
import { setProjectOnHoldAction } from '@/app/actions/projects';

/**
 * Park a job while somebody else finishes their part — or put it back to work.
 *
 * A hold is not a status. The job is still sold, still planned, and its phases
 * stay on the schedule where the projected finish and the crew can see them;
 * what the hold records is that nothing is waiting on US. That is why the
 * reason is required rather than optional: "on hold" alone is unreadable a
 * fortnight later, and "waiting on the GC to pour the slab" tells the next
 * person who to ring.
 *
 * Shown wherever the schedule shows a job, for the same reason the hard finish
 * date is: the point of it is to be visible while the dates are being read.
 */
export function OnHoldControl({
  projectId,
  projectName,
  onHold,
  reason: current,
  since = null,
  compact = true,
}: {
  projectId: number;
  projectName: string;
  onHold: boolean;
  /** What it is waiting on; only meaningful while it's held. */
  reason: string | null;
  /** When it was parked, so a long hold reads as one. */
  since?: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(hold: boolean) {
    setError(null);
    setBusy(true);
    const res = await setProjectOnHoldAction(projectId, hold, hold ? reason : null);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not save that.');
      return;
    }
    setOpen(false);
    if (!hold) setReason('');
    router.refresh();
  }

  return (
    <>
      <button
        className={`font-medium ${compact ? 'text-[11px]' : 'text-xs'} ${
          onHold
            ? 'text-amber-800 hover:underline'
            : 'text-brand-gray hover:text-brand-ink hover:underline'
        }`}
        onClick={() => {
          setReason(current ?? '');
          setError(null);
          setOpen(true);
        }}
        title={
          onHold
            ? `On hold${since ? ` since ${shortDate(since)}` : ''}${
                current ? ` — waiting on ${current}` : ''
              }. Click to change it or put the job back to work.`
            : 'Park this job while somebody else finishes their part'
        }
      >
        {onHold ? 'On hold — edit' : '+ Put on hold'}
      </button>

      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={onHold ? `On hold: ${projectName}` : `Put on hold: ${projectName}`}
        >
          <div className="space-y-4">
            <p className="text-sm text-brand-gray">
              For work that is waiting on somebody else — the general contractor, the owner, another
              trade. The job keeps its dates, its phases and its place on the schedule; a hold says
              nothing is waiting on us, so a job standing still stops looking like a job nobody has
              noticed.
            </p>
            {onHold && since && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                On hold since {shortDate(since)}.
              </p>
            )}
            <div>
              <label className="label">What Is It Waiting On? *</label>
              <input
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="GC hasn't poured the slab in the east wing"
              />
              <p className="mt-1 text-xs text-brand-gray">
                Shown on the schedule and the job, so whoever looks next knows who to chase.
              </p>
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </button>
              {onHold && (
                <button className="btn-secondary" onClick={() => save(false)} disabled={busy}>
                  {busy ? 'Saving…' : 'Back To Work'}
                </button>
              )}
              <button
                className="btn-primary"
                onClick={() => save(true)}
                disabled={busy || reason.trim() === ''}
                title={reason.trim() === '' ? 'Say what this job is waiting on' : undefined}
              >
                {busy ? 'Saving…' : onHold ? 'Save' : 'Put On Hold'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
