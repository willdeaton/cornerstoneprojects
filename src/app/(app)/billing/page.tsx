import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listBillingProjects } from '@/lib/data';
import { money, shortDate } from '@/lib/format';
import {
  billingSummary,
  billingVariance,
  BILLING_STAGE_LABELS,
  type BillingStage,
  type BillingSummary,
} from '@/lib/billing';
import { PageHeader, StatCard, EmptyState, BillingStageBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * The billing desk: every job that has finished the work, in the order the
 * billing wants doing.
 *
 * The tabs are the pipeline, not a filter menu — a job appears under exactly
 * one of them, and it moves between them on its own as the invoice rows on the
 * project are ticked Billed and Paid. Nothing on this page is edited here:
 * it's a queue that points at the job to work on next.
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

type Row = {
  project: { id: number; customer: string; name: string; completed_at: string | null };
  summary: BillingSummary;
  holdReason: string | null;
  hours: number;
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  // Same gate as Settings — what every customer owes us isn't a worker's view.
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/projects');

  const { stage } = await searchParams;
  const tab = TABS.find((t) => t.key === stage) ?? TABS[0];

  const desk = await listBillingProjects();
  const rows: Row[] = desk.map((d) => ({
    project: d.project,
    summary: billingSummary(d.project, d.tally),
    holdReason: d.project.billing_hold_reason,
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

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle="Completed work, from ready-to-bill through to paid and closed"
      >
        <Link href="/projects?status=completed" className="btn-secondary">
          Completed Jobs
        </Link>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Ready to Bill"
          value={money(readyValue)}
          accent="amber"
          hint={`${readyCount} ${readyCount === 1 ? 'job' : 'jobs'} finished, nothing sent`}
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
        <div className="space-y-3">
          {shown.map((r) => (
            <BillingRow key={r.project.id} row={r} />
          ))}
        </div>
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

/**
 * One job on the desk. The row leads with the stage and the age, because the
 * question this page answers is "which job next" — the money is what you check
 * once you've picked one.
 */
function BillingRow({ row }: { row: Row }) {
  const { project: p, summary: s } = row;
  const variance = billingVariance(s);
  const age =
    s.ageDays == null
      ? null
      : s.ageDays === 0
        ? 'completed today'
        : `${s.ageDays}d since completion`;

  return (
    <Link
      href={`/projects/${p.id}`}
      className="card-interactive group block p-4"
      aria-label={`${p.name} — ${BILLING_STAGE_LABELS[s.stage]}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 lg:flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="eyebrow truncate">{p.customer}</p>
            <BillingStageBadge stage={s.stage} urgency={s.urgency} />
          </div>
          <h3 className="brand-heading mt-1 truncate text-brand-ink transition-colors duration-150 group-hover:text-brand-green-dark">
            {p.name}
          </h3>
          <p className="tnum mt-1 text-xs text-brand-gray">
            {age && (
              <span className={s.urgency === 'late' ? 'font-semibold text-red-600' : undefined}>
                {age}
              </span>
            )}
            {p.completed_at && <span> · completed {shortDate(p.completed_at)}</span>}
            {row.hours > 0 && <span> · {row.hours.toFixed(1)}h logged</span>}
            {s.count > 0 && (
              <span>
                {' '}
                · {s.count} {s.count === 1 ? 'invoice' : 'invoices'}
              </span>
            )}
          </p>
        </div>

        <dl className="tnum grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 lg:shrink-0 lg:text-right">
          <Cell label="Contract" value={money(s.contract)} />
          <Cell label="Invoiced" value={money(s.invoiced)} />
          <Cell label="Paid" value={money(s.paid)} />
          <Cell
            label="Outstanding"
            value={money(s.outstanding)}
            alert={s.outstanding > 0 && s.stage !== 'closed'}
          />
        </dl>
      </div>

      {(row.holdReason || variance || s.unbilled > 0) && (
        <div className="mt-3 space-y-1 border-t border-surface-line pt-2 text-xs">
          {s.stage === 'on_hold' && row.holdReason && (
            <p className="text-brand-gray-dark">
              <span className="font-semibold">On hold — </span>
              {row.holdReason}
            </p>
          )}
          {s.unbilled > 0 && (
            <p className="text-amber-700">
              {money(s.unbilled)} raised on an invoice that hasn&apos;t gone out yet.
            </p>
          )}
          {variance === 'short' && (
            <p className="text-amber-700">
              {money(s.uninvoiced)} of the contract has no invoice against it.
            </p>
          )}
          {variance === 'over' && (
            <p className="text-amber-700">
              Invoiced {money(-s.uninvoiced)} over contract — check for a change order.
            </p>
          )}
        </div>
      )}
    </Link>
  );
}

function Cell({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-brand-gray">
        {label}
      </dt>
      <dd className={`text-sm font-semibold ${alert ? 'text-amber-700' : 'text-brand-ink'}`}>
        {value}
      </dd>
    </div>
  );
}
