import { getUserName, listProjectInvoices, listProjectValueChanges } from '@/lib/data';
import {
  billingSummary,
  tallyInvoices,
  originalContractValue,
  contractRevised,
  contractLocked,
} from '@/lib/billing';
import { money } from '@/lib/format';
import { loadProject, requireJobBiller } from '../job';
import { BillingSection } from '@/components/billing/BillingSection';
import { InvoiceSection } from '@/components/billing/InvoiceSection';
import { ContractValueControl } from '@/components/billing/ContractValueControl';
import { ContractValueHistory } from '@/components/billing/ContractValueHistory';

export const dynamic = 'force-dynamic';

/**
 * Where the money on this job stands, and the ledger it's derived from.
 *
 * Both halves are on one tab because they are one concern: the stage, the aging
 * and the variance above are computed from the invoice rows below, so they can
 * never disagree. Both are the same components the billing desk opens inline,
 * so a job's billing reads and behaves identically whichever way you came at
 * it. Admins and managers only — enforced here, not by hiding the tab, and
 * again in `updateInvoiceAction` so the ledger can't be posted to either.
 */
export default async function ProjectBillingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const project = await loadProject(idParam);
  await requireJobBiller(project.id);

  const [invoices, valueChanges] = await Promise.all([
    listProjectInvoices(project.id),
    listProjectValueChanges(project.id),
  ]);
  const summary = billingSummary(project, tallyInvoices(invoices));
  const soldAt = originalContractValue(project.value, valueChanges);
  const closedByName = project.billing_closed_by
    ? await getUserName(project.billing_closed_by)
    : null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <InvoiceSection project={project} invoices={invoices} />
      </div>
      <div className="space-y-6">
        <BillingSection
          projectId={project.id}
          summary={summary}
          holdReason={project.billing_hold_reason}
          closedAt={project.billing_closed_at}
          closedByName={closedByName}
          soldAt={soldAt}
        />

        {/* The contract value and why it is what it is. Beside the billing card
            because that card is what flags a job invoiced over its contract —
            this is where that flag is answered. */}
        <div className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="brand-heading text-sm text-brand-gray">Contract Value</h2>
            <ContractValueControl
              projectId={project.id}
              projectName={project.name}
              locked={contractLocked(summary.stage)}
            />
          </div>
          <p className="tnum mb-1 text-2xl font-semibold text-brand-ink">
            {money(project.value, { cents: true })}
          </p>
          <p className="mb-4 text-xs text-brand-gray">
            {contractRevised(project.value, soldAt)
              ? `Sold at ${money(soldAt, { cents: true })} · ${valueChanges.length} change${
                  valueChanges.length === 1 ? '' : 's'
                } since`
              : 'What the job was sold for.'}
          </p>
          <ContractValueHistory changes={valueChanges} />
        </div>
      </div>
    </div>
  );
}
