'use client';

import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { sendScheduleAction } from '@/app/actions/schedule';
import type { SendScheduleResult } from '@/lib/email/send';

/**
 * Emails everyone booked in a date range their own dates. Defaults to the range
 * currently on screen, so "send what I'm looking at" is one click plus confirm.
 */
export function SendScheduleModal({
  defaultFrom,
  defaultTo,
  onClose,
}: {
  defaultFrom: string;
  defaultTo: string;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [includeSubs, setIncludeSubs] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendScheduleResult | null>(null);

  async function send() {
    setSending(true);
    setResult(await sendScheduleAction(from, to, includeSubs));
    setSending(false);
  }

  return (
    <Modal open onClose={onClose} title="Send Schedule">
      <div className="space-y-4">
        {result ? (
          <>
            {result.status === 'error' ? (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                <p className="font-semibold">Nothing was sent.</p>
                <p>{result.reason}</p>
              </div>
            ) : (
              <div className="rounded-lg bg-brand-green/10 px-3 py-2 text-sm text-brand-ink">
                <p className="font-semibold">
                  {result.count === 0
                    ? 'No emails sent.'
                    : `Sent to ${result.count} of ${result.attempted}.`}
                </p>
                {result.reason && <p className="text-brand-gray">{result.reason}</p>}
              </div>
            )}
            {result.skipped.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-semibold">Skipped</p>
                <ul className="mt-1 space-y-0.5">
                  {result.skipped.map((s) => (
                    <li key={`${s.name}-${s.reason}`}>
                      {s.name} — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <button className="btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-brand-gray">
              Everyone scheduled in this range gets one email listing only their own work.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">From</label>
                <input
                  className="input"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="label">To</label>
                <input
                  className="input"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-brand-ink">
              <input
                type="checkbox"
                checked={includeSubs}
                onChange={(e) => setIncludeSubs(e.target.checked)}
              />
              Also send to subcontractors with an email address
            </label>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={onClose} disabled={sending}>
                Cancel
              </button>
              <button className="btn-primary" onClick={send} disabled={sending || to < from}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
