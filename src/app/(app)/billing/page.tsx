import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listBillingProjects } from '@/lib/data';
import { money } from '@/lib/format';
import { billingSummary, type BillingStage } from '@/lib/billing';
import { PageHeader, StatCard, EmptyState } from '@/components/ui';
import { BillingDesk, type DeskRow } from './BillingDesk';

export const dynamic = 'force-dynamic';

/**
 * The billing desk: every job that has finished the work, in the order the
 * billing wants doing — and the place billing is actually done.
 *
 * The tabs are the pipeline, not a filter menu — a job appears under exactly
 * one of them, and it moves between them on its own as its invoices are ticked
 * Sent and Paid. Which is the point of working here: opening a job brings its
 * ledger and its stage decisions down into the row (see `BillingDesk`), so a
 * pass down the queue is a pass down one page, and a job that gets settled
 * leaves the tab it was in as you go.
 *
 * This page still only computes and lays out. Every write behind an opened row
 * goes through the same components and actions the job's Billing tab uses, so
 * there is one way to edit billing however you got to it.
 */

/** A tab, and the stages it collects. "All" carries every stage. */
const TABS: { key: string; label: string; stages: BillingStage[] | null }[] = [
  { key: 'ready', label: 'Ready to Bill', stages: ['ready_to_bill'] },
  { key: 'outstanding', label: 'Outstanding', stages: ['invoiced'] },
  { key: 'hold', label: 'On Hold', stages: ['on_hold'] },
  { key: 'paid', label: 'Paid', stages: ['paid'] },
  { key: 'closed', label: 'Closed', stages: ['closed'] },
  { key: 'all', label: 'All', stages: null },
];

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  // Same gate as Settings — what every customer owes us isn't an employee's view.
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/projects');

  const { stage } = await searchParams;
  const tab = TABS.find((t) => t.key === stage) ?? TABS[0];

  const desk = await listBillingProjects();
  const rows: DeskRow[] = desk.map((d) => ({
    project: d.project,
    summary: billingSummary(d.project, d.tally),
    holdReason: d.project.billing_hold_reason,
    closedByName: d.closed_by_name,
    hours: d.hours,
  }));

  const counts = new Map<string, number>(
    TABS.map((t) => [
      t.key,
      rows.filter((r) => !t.stages || t.stages.includes(r.summary.stage)).length,
    ])
  );

  const shown = tab.stages
    ? rows.filter((r) => tab.stages!.includes(r.summary.stage))
    : // "All" leads with the work still to do, then everything settled.
      [...rows].sort((a, b) => stageRank(a.summary.stage) - stageRank(b.summary.stage));

  // Headline figures cover the whole desk, not the open tab — they're the
  // reason to come to this page, and they shouldn't move when a tab changes.
  // The billing sitting on the desk: for a job nothing has gone out for, that
  // is its contract value — or whatever has been raised against it, when a
  // change order has already pushed a draft invoice past the contract.
  const readyValue = rows
    .filter((r) => r.summary.stage === 'ready_to_bill')
    .reduce((t, r) => t + Math.max(r.summary.contract, r.summary.invoiced), 0);
  const readyCount = counts.get('ready') ?? 0;
  const outstanding = rows
    .filter((r) => r.summary.stage === 'invoiced' || r.summary.stage === 'on_hold')
    .reduce((t, r) => t + r.summary.outstanding, 0);
  const lateCount = rows.filter((r) => r.summary.urgency === 'late').length;
  const collected = rows.reduce((t, r) => t + r.summary.paid, 0);
  // Contract value nobody has sent an invoice for yet, across every job still
  // on the desk. Closed jobs are done being billed whatever their figures say,
  // and an over-billed job contributes nothing rather than a negative.
  const leftToBill = rows
    .filter((r) => r.summary.stage !== 'closed')
    .reduce((t, r) => t + Math.max(0, r.summary.leftToBill), 0);

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle="Completed work, from ready-to-bill through to paid and closed — open a job to bill it"
      >
        <Link href="/projects?status=completed" className="btn-secondary">
          Completed Jobs
        </Link>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Ready to Bill"
          value={money(readyValue)}
          accent="amber"
          hint={`${readyCount} ${readyCount === 1 ? 'job' : 'jobs'} finished, nothing sent`}
        />
        <StatCard
          label="Left to Bill"
          value={money(leftToBill)}
          accent="gray"
          hint="Contract value not yet invoiced out"
        />
        <StatCard
          label="Awaiting Payment"
          value={money(outstanding)}
          accent="gray"
          hint="Invoiced and not yet paid"
        />
        <StatCard
          label="Needs Chasing"
          value={String(lateCount)}
          accent={lateCount > 0 ? 'amber' : 'gray'}
          hint="Past the point it should have moved"
        />
        <StatCard label="Collected" value={money(collected)} accent="green" hint="Paid to date" />
      </div>

      <div className="mt-6 mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="segmented">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/billing?stage=${t.key}`}
              className={`segment ${tab.key === t.key ? 'segment-on' : ''}`}
            >
              {t.label}
              <span className="tnum ml-1.5 opacity-60">{counts.get(t.key) ?? 0}</span>
            </Link>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={emptyTitle(tab.key)}
          hint={
            desk.length === 0
              ? 'Jobs land here once they are marked Completed, or as soon as anything is invoiced against them.'
              : undefined
          }
        />
      ) : (
        <BillingDesk rows={shown} />
      )}
    </div>
  );
}

/** Work still to do sorts above work already settled on the "All" tab. */
function stageRank(stage: BillingStage): number {
  const order: BillingStage[] = [
    'ready_to_bill',
    'invoiced',
    'on_hold',
    'paid',
    'closed',
    'not_ready',
  ];
  return order.indexOf(stage);
}

function emptyTitle(key: string): string {
  switch (key) {
    case 'ready':
      return 'Nothing waiting to be billed';
    case 'outstanding':
      return 'Nothing outstanding';
    case 'hold':
      return 'No billing on hold';
    case 'paid':
      return 'Nothing paid and waiting to close';
    case 'closed':
      return 'Nothing closed out yet';
    default:
      return 'Nothing on the billing desk';
  }
}
