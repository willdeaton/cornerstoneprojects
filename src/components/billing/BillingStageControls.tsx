'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money, shortDate } from '@/lib/format';
import { type BillingSummary } from '@/lib/billing';
import {
  setBillingHoldAction,
  setBillingClosedAction,
  markBillingAction,
} from '@/app/actions/billing';

/**
 * The decisions about a job's billing that no invoice row can express, in one
 * strip used both on the job's Billing tab and inline on the billing desk.
 *
 * Parking billing with a reason is one of them. Signing the job off is the
 * other, and it is the billing desk's act alone: the job's own Billing card
 * passes `allowCloseOut={false}`, so a job is closed out from the desk that
 * queues it and nowhere else. Reopening is offered wherever a closed job
 * appears, so nothing that was closed is stuck that way.
 *
 * The rest are the short path — marking the job billed, or billed and paid,
 * without typing an invoice at all. That is a real way of working, not a
 * shortcut around the ledger: work invoiced and collected outside this app
 * still has to be able to leave the desk, and a queue that demands an invoice
 * number and a send date first is a queue people stop updating. (The job's own
 * PO does come along on a row raised this way — it was recorded before any of
 * this, so nothing is being asked for that isn't already known.) What the
 * mark writes is an ordinary invoice row, so the stage and every total follow
 * from it exactly as they would have by hand — and the ledger below is where it
 * gets a number later, or gets undone.
 */
export function BillingStageControls({
  projectId,
  summary,
  holdReason,
  closedAt,
  closedByName,
  allowCloseOut = true,
  onChanged,
}: {
  projectId: number;
  summary: BillingSummary;
  holdReason: string | null;
  closedAt: string | null;
  closedByName?: string | null;
  /**
   * Whether closing the job out is offered here. Off on the job's Billing card
   * — signing a job off the billing desk belongs to the desk. Reopening is
   * offered either way when the job is already closed.
   */
  allowCloseOut?: boolean;
  /** Called after a change lands, for a view holding its own copy of the rows. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The hold reason input is only on screen while a hold is being placed.
  const [holdOpen, setHoldOpen] = useState(false);
  const [reason, setReason] = useState('');

  const held = summary.stage === 'on_hold' || (!!holdReason && !closedAt);
  const closed = !!closedAt;

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) {
        setError(res.error);
        return;
      }
      setHoldOpen(false);
      setReason('');
      onChanged?.();
      router.refresh();
    });
  }

  // Nothing raised at all is the case the quick marks are really for; with rows
  // on the job they mark whatever is still outstanding. Either way the buttons
  // disappear once there is nothing left for them to do.
  const nothingRaised = summary.count === 0;
  const unsent = summary.count - summary.billedCount;
  const unpaid = summary.count - summary.paidCount;
  const canMarkBilled = !closed && (nothingRaised || unsent > 0);
  const canMarkPaid = !closed && (nothingRaised || unpaid > 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {canMarkBilled && (
          <button
            type="button"
            className="btn-secondary px-3 py-1 text-xs"
            disabled={pending}
            title={
              nothingRaised
                ? `Records ${money(summary.contract)} as sent, with no invoice number or PDF — against the job's PO if one is on file`
                : `Marks ${unsent} ${unsent === 1 ? 'invoice' : 'invoices'} as sent`
            }
            onClick={() => run(() => markBillingAction(projectId, 'billed'))}
          >
            {nothingRaised ? 'Mark Billed' : 'Mark All Sent'}
          </button>
        )}
        {canMarkPaid && (
          <button
            type="button"
            className="btn-secondary px-3 py-1 text-xs"
            disabled={pending}
            title={
              nothingRaised
                ? `Records ${money(summary.contract)} as sent and paid, with no invoice details`
                : `Marks ${unpaid} ${unpaid === 1 ? 'invoice' : 'invoices'} as paid`
            }
            onClick={() => run(() => markBillingAction(projectId, 'paid'))}
          >
            {nothingRaised ? 'Mark Paid' : 'Mark All Paid'}
          </button>
        )}
        {!closed &&
          (held ? (
            <button
              type="button"
              className="btn-secondary px-3 py-1 text-xs"
              disabled={pending}
              onClick={() => run(() => setBillingHoldAction(projectId, false, ''))}
            >
              Release Hold
            </button>
          ) : (
            <button
              type="button"
              className="btn-secondary px-3 py-1 text-xs"
              disabled={pending}
              onClick={() => setHoldOpen((o) => !o)}
            >
              {holdOpen ? 'Cancel' : 'Put on Hold'}
            </button>
          ))}
        {(closed || allowCloseOut) && (
          <button
            type="button"
            className={`px-3 py-1 text-xs ${closed ? 'btn-secondary' : 'btn-primary'}`}
            disabled={pending}
            onClick={() => run(() => setBillingClosedAction(projectId, !closed))}
          >
            {closed ? 'Reopen Billing' : 'Close Out'}
          </button>
        )}
      </div>

      {/* Say what the short path will actually write, once, where the decision
          is being made — a job with no invoices is the only case where a mark
          creates something rather than ticking what is already there. */}
      {nothingRaised && (canMarkBilled || canMarkPaid) && (
        <p className="mt-2 text-xs text-brand-gray">
          Marking a job with no invoices raised puts its contract value{' '}
          <strong className="text-brand-ink">{money(summary.contract)}</strong> on one invoice with
          no number and no PDF, billed against the job&apos;s PO if one is on file. Fill the detail
          in below if you ever need it.
        </p>
      )}

      {/* Placing a hold: the reason is the point of it, so it's required. */}
      {holdOpen && !held && !closed && (
        <div className="mt-3 rounded-xl border border-surface-line bg-black/[0.02] p-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
            Why is billing on hold?
          </label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input
              className="input"
              value={reason}
              autoFocus
              placeholder="Retainage until punch list signed off…"
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  run(() => setBillingHoldAction(projectId, true, reason));
                }
              }}
            />
            <button
              type="button"
              className="btn-primary shrink-0 px-3 py-2 text-xs"
              disabled={pending}
              onClick={() => run(() => setBillingHoldAction(projectId, true, reason))}
            >
              {pending ? 'Saving…' : 'Hold Billing'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}

      {held && holdReason && (
        <p className="mt-3 rounded-xl bg-brand-gray/10 p-3 text-sm text-brand-gray-dark">
          <span className="font-semibold text-brand-ink">On hold — </span>
          {holdReason}
        </p>
      )}

      {closed && (
        <p className="mt-3 rounded-xl bg-brand-ink/[0.06] p-3 text-sm text-brand-gray-dark">
          Closed out {shortDate(closedAt)}
          {closedByName ? ` by ${closedByName}` : ''}. Reopen it to bill anything further.
        </p>
      )}
    </div>
  );
}
