'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { shortDate } from '@/lib/format';
import { setHardFinishDateAction } from '@/app/actions/schedule';

/**
 * A job's hard finish date — the day the work has to be done by, as opposed to
 * the due date it's aimed at. Shown wherever the schedule shows a job, because
 * the whole point of it is to be visible while the dates are being moved around.
 *
 * Moving a date that was already promised asks why; setting one for the first
 * time doesn't, since nothing has moved yet.
 */
export function HardFinishControl({
  projectId,
  projectName,
  hardFinishDate,
  /** The job's projected finish, so the control can say when it's already past. */
  projectedEnd = null,
  compact = true,
}: {
  projectId: number;
  projectName: string;
  hardFinishDate: string | null;
  projectedEnd?: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(hardFinishDate ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const missed = !!(hardFinishDate && projectedEnd && projectedEnd > hardFinishDate);
  // Only a date that already existed and is being replaced counts as a move.
  const next = date.trim() === '' ? null : date.trim();
  const reasonRequired = hardFinishDate != null && next != null && next !== hardFinishDate;

  async function save() {
    setError(null);
    setBusy(true);
    const res = await setHardFinishDateAction(projectId, next, reason);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not save that date.');
      return;
    }
    setOpen(false);
    setReason('');
    router.refresh();
  }

  return (
    <>
      <button
        className={`font-medium ${compact ? 'text-[11px]' : 'text-xs'} ${
          missed
            ? 'text-red-700 hover:underline'
            : hardFinishDate
              ? 'text-brand-ink hover:underline'
              : 'text-brand-gray hover:text-brand-ink hover:underline'
        }`}
        onClick={() => setOpen(true)}
        title={
          hardFinishDate
            ? `This job has to be finished by ${shortDate(hardFinishDate)}`
            : 'Set a date this job has to be finished by'
        }
      >
        {hardFinishDate ? `Must finish ${shortDate(hardFinishDate)}` : '+ Hard finish date'}
        {missed && ' · at risk'}
      </button>

      {open && (
        <Modal open onClose={() => setOpen(false)} title={`Hard finish date: ${projectName}`}>
          <div className="space-y-4">
            <p className="text-sm text-brand-gray">
              The date this job absolutely has to be finished by — a contract date or a customer
              commitment. The schedule warns whenever the planned work runs past it, and moving it
              later is recorded in this job&apos;s change history.
            </p>
            <div>
              <label className="label">Hard Finish Date</label>
              <input
                className="input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <p className="mt-1 text-xs text-brand-gray">
                Clear the date to drop the commitment.
              </p>
            </div>
            {reasonRequired && (
              <div>
                <label className="label">Reason For Moving It *</label>
                <input
                  className="input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Customer agreed to a two-week extension"
                />
              </div>
            )}
            {missed && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                The scheduled work currently ends {shortDate(projectedEnd)}, after this date.
              </p>
            )}
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={save}
                disabled={busy || (reasonRequired && reason.trim() === '')}
                title={
                  reasonRequired && reason.trim() === ''
                    ? 'A reason is required to move a hard finish date'
                    : undefined
                }
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
