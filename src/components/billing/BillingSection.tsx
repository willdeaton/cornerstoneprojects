import { money } from '@/lib/format';
import { BillingStageBadge } from '@/components/ui';
import {
  billingVariance,
  contractRevised,
  BILLING_SLA,
  type BillingSummary,
} from '@/lib/billing';
import { BillingStageControls } from './BillingStageControls';

/**
 * Where this job stands on the billing desk, and the decisions about it a
 * person can make from here — all of which live in `BillingStageControls`,
 * shared with the billing desk so the same job reads and behaves the same in
 * both places.
 *
 * Closing a job out is not one of them: signing a job off the billing desk is
 * the desk's own act, so this card offers everything but that. A job already
 * closed can still be reopened from here, so nothing is stuck that way.
 *
 * The money on this card is read-only on purpose: the stage and the figures
 * come out of the invoice rows in the card below, so this one never offers a
 * second place to edit the same numbers.
 */
export function BillingSection({
  projectId,
  summary,
  holdReason,
  closedAt,
  closedByName,
  soldAt,
}: {
  projectId: number;
  summary: BillingSummary;
  holdReason: string | null;
  closedAt: string | null;
  closedByName: string | null;
  /** What the job was sold for, when a change order has moved it since. */
  soldAt?: number;
}) {
  const closed = !!closedAt;
  const variance = billingVariance(summary);

  const sla =
    summary.stage === 'ready_to_bill' || summary.stage === 'invoiced'
      ? BILLING_SLA[summary.stage]
      : null;

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="brand-heading text-sm text-brand-gray">Billing</h2>
        <BillingStageBadge stage={summary.stage} urgency={summary.urgency} />
      </div>

      <div className="mb-4">
        <BillingStageControls
          projectId={projectId}
          summary={summary}
          holdReason={holdReason}
          closedAt={closedAt}
          closedByName={closedByName}
          allowCloseOut={false}
        />
      </div>

      {/* The money, contract-first: what the job is worth, what has been
          raised against it, and what is still owed. */}
      {/* Five figures now, so the count follows the width: three across when
          the card has the page, two when it's the narrow sidebar column. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-2">
        <Figure
          label="Contract"
          value={money(summary.contract)}
          hint={
            soldAt != null && contractRevised(summary.contract, soldAt)
              ? `Sold at ${money(soldAt)}`
              : undefined
          }
        />
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
            customer&apos;s PO, the amount and the PDF that went out — or mark the job billed above
            if there is no invoice to record.
          </p>
        )}
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  strong,
  hint,
}: {
  label: string;
  value: string;
  strong?: boolean;
  /** A second line under the figure, for what it used to be. */
  hint?: string;
}) {
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
      {hint && <p className="tnum mt-0.5 text-xs text-brand-gray">{hint}</p>}
    </div>
  );
}
