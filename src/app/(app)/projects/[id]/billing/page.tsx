import { getUserName, listProjectInvoices } from '@/lib/data';
import { billingSummary, tallyInvoices } from '@/lib/billing';
import { loadProject, requireJobBiller } from '../job';
import { BillingSection } from '@/components/billing/BillingSection';
import { InvoiceSection } from '@/components/billing/InvoiceSection';

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

  const invoices = await listProjectInvoices(project.id);
  const summary = billingSummary(project, tallyInvoices(invoices));
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
        />
      </div>
    </div>
  );
}
