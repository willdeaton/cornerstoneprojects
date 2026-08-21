'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money, shortDate } from '@/lib/format';
import { BillingStageBadge } from '@/components/ui';
import { billingVariance, BILLING_SLA, type BillingSummary } from '@/lib/billing';
import { setBillingHoldAction, setBillingClosedAction } from '@/app/actions/billing';

/**
 * Where this job stands on the billing desk, and the two decisions only a
 * person can make about it: parking billing (with a reason) and signing the
 * job off.
 *
 * Everything else on this card is read-only on purpose — the stage and the
 * money come out of the invoice rows in the card below, so this one never
 * offers a second place to edit the same numbers.
 */
export function BillingSection({
  projectId,
  summary,
  holdReason,
  closedAt,
  closedByName,
}: {
  projectId: number;
  summary: BillingSummary;
  holdReason: string | null;
  closedAt: string | null;
  closedByName: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The hold reason input is only on screen while a hold is being placed.
  const [holdOpen, setHoldOpen] = useState(false);
  const [reason, setReason] = useState('');

  const held = summary.stage === 'on_hold' || (!!holdReason && !closedAt);
  const closed = !!closedAt;
  const variance = billingVariance(summary);

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
      router.refresh();
    });
  }

  const sla =
    summary.stage === 'ready_to_bill' || summary.stage === 'invoiced'
      ? BILLING_SLA[summary.stage]
      : null;

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="brand-heading text-sm text-brand-gray">Billing</h2>
          <BillingStageBadge stage={summary.stage} urgency={summary.urgency} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <button
            type="button"
            className={`px-3 py-1 text-xs ${closed ? 'btn-secondary' : 'btn-primary'}`}
            disabled={pending}
            onClick={() => run(() => setBillingClosedAction(projectId, !closed))}
          >
            {closed ? 'Reopen Billing' : 'Close Out'}
          </button>
        </div>
      </div>

      {/* Placing a hold: the reason is the point of it, so it's required. */}
      {holdOpen && !held && !closed && (
        <div className="mb-4 rounded-xl border border-surface-line bg-black/[0.02] p-3">
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

      {error && <p className="mb-3 text-sm font-medium text-red-600">{error}</p>}

      {held && holdReason && (
        <p className="mb-4 rounded-xl bg-brand-gray/10 p-3 text-sm text-brand-gray-dark">
          <span className="font-semibold text-brand-ink">On hold — </span>
          {holdReason}
        </p>
      )}

      {closed && (
        <p className="mb-4 rounded-xl bg-brand-ink/[0.06] p-3 text-sm text-brand-gray-dark">
          Closed out {shortDate(closedAt)}
          {closedByName ? ` by ${closedByName}` : ''}. Reopen it to bill anything further.
        </p>
      )}

      {/* The money, contract-first: what the job is worth, what has been
          raised against it, and what is still owed. */}
      {/* Five figures now, so the count follows the width: three across when
          the card has the page, two when it's the narrow sidebar column. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-2">
        <Figure label="Contract" value={money(summary.contract)} />
        <Figure label="Invoiced" value={money(summary.invoiced, { cents: true })} />
        {/* Left to bill counts what has actually gone out, so an invoice
            raised and not sent still reads as work left to bill. Clamped at
            zero — an over-bill is called out in words below, not as a
            negative figure here. */}
        <Figure
          label="Left to Bill"
          value={money(Math.max(0, summary.leftToBill), { cents: true })}
          strong={summary.leftToBill > 0 && summary.stage !== 'closed'}
        />
        <Figure label="Paid" value={money(summary.paid, { cents: true })} />
        <Figure
          label="Outstanding"
          value={money(summary.outstanding, { cents: true })}
          strong={summary.outstanding > 0}
        />
      </dl>

      <div className="mt-4 space-y-2 border-t border-surface-line pt-3 text-sm">
        {summary.ageDays != null ? (
          <p className="text-brand-gray">
            Completed{' '}
            <strong className="text-brand-ink">
              {summary.ageDays === 0 ? 'today' : `${summary.ageDays} days ago`}
            </strong>
            {sla && summary.urgency !== 'none' && (
              <span className={summary.urgency === 'late' ? 'text-red-600' : 'text-amber-700'}>
                {' · '}
                {summary.stage === 'ready_to_bill'
                  ? 'still not invoiced'
                  : 'past normal terms'}{' '}
                ({sla.late}+ days is late)
              </span>
            )}
          </p>
        ) : (
          <p className="text-brand-gray">
            The job isn&apos;t marked complete yet — mark it Completed to put it in the billing
            queue.
          </p>
        )}

        {summary.unbilled > 0 && (
          <p className="text-amber-700">
            {money(summary.unbilled, { cents: true })} is on an invoice that hasn&apos;t gone out
            yet — tick <strong>Sent</strong> on it once it does.
          </p>
        )}

        {variance === 'short' && (
          <p className="text-amber-700">
            {money(summary.uninvoiced, { cents: true })} of the contract value has no invoice
            against it.
          </p>
        )}
        {variance === 'over' && (
          <p className="text-amber-700">
            Invoiced {money(-summary.uninvoiced, { cents: true })} over the contract value — worth
            checking against a change order.
          </p>
        )}

        {summary.count === 0 && !closed && (
          <p className="text-brand-gray">
            No invoices raised yet. Add the first one in the Invoicing card — its number, the
            customer&apos;s PO, the amount and the PDF that went out.
          </p>
        )}
      </div>
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-brand-gray">{label}</dt>
      <dd
        className={`tnum mt-0.5 text-lg font-semibold ${
          strong ? 'text-amber-700' : 'text-brand-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
