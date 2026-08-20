import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listProjects, projectHours, listInvoiceTallies } from '@/lib/data';
import {
  billingSummary,
  EMPTY_TALLY,
  onBillingDesk,
  type InvoiceTally,
} from '@/lib/billing';
import type { ProjectStatus } from '@/lib/types';
import { money, shortDate, duration } from '@/lib/format';
import {
  PageHeader,
  ProjectStatusBadge,
  ProgressBar,
  EmptyState,
  BillingStageBadge,
} from '@/components/ui';
import { AddProjectButton } from './AddProjectButton';

export const dynamic = 'force-dynamic';

const TABS: { key: string; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'not_started', label: 'Not Started' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role === 'employee') redirect('/time');

  const { status } = await searchParams;
  const filter = status ?? 'active';
  let projects = await listProjects(
    filter === 'all' || filter === 'active' ? undefined : (filter as ProjectStatus)
  );
  if (filter === 'active') projects = projects.filter((p) => p.status !== 'completed');

  const total = projects.reduce((s, p) => s + p.value, 0);
  const hoursById = new Map(
    await Promise.all(projects.map(async (p) => [p.id, await projectHours(p.id)] as const))
  );
  // Billing is an admin/manager concern, same as the Billing page itself.
  const canBill = me.role === 'admin' || me.role === 'manager';
  const tallies: Map<number, InvoiceTally> = canBill
    ? await listInvoiceTallies(projects.map((p) => p.id))
    : new Map();

  return (
    <div>
      <PageHeader title="Projects" subtitle="Sold work and where it stands">
        <AddProjectButton />
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="segmented">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/projects?status=${t.key}`}
              className={`segment ${filter === t.key ? 'segment-on' : ''}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <p className="tnum text-sm text-brand-gray">
          <span className="font-semibold text-brand-ink">{projects.length}</span> jobs ·{' '}
          <span className="font-semibold text-brand-ink">{money(total)}</span>
        </p>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title="No projects here yet"
          hint="Sell a quote from the Quotes tab, or add a project directly."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const hrs = hoursById.get(p.id) ?? 0;
            // On a finished job the progress bar is always full, so the card
            // gives that room to where the job stands on billing instead.
            const billing = canBill
              ? billingSummary(p, tallies.get(p.id) ?? EMPTY_TALLY)
              : null;
            const showBilling = billing != null && onBillingDesk(billing.stage);
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="card-interactive group p-5"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="eyebrow truncate">{p.customer}</p>
                    <h3 className="brand-heading mt-1 text-brand-ink transition-colors duration-150 group-hover:text-brand-green-dark">
                      {p.name}
                    </h3>
                  </div>
                  <ProjectStatusBadge status={p.status} />
                </div>

                {showBilling ? (
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-brand-gray">
                    <BillingStageBadge stage={billing.stage} urgency={billing.urgency} />
                    {billing.outstanding > 0 && (
                      <span className="tnum">
                        {money(billing.outstanding)} outstanding
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mb-3">
                    <div className="mb-1 flex justify-between text-xs text-brand-gray">
                      <span>Progress</span>
                      <span className="tnum font-semibold text-brand-ink">{p.progress}%</span>
                    </div>
                    <ProgressBar value={p.progress} />
                  </div>
                )}

                <div className="flex items-center justify-between border-t border-surface-line pt-3 text-sm">
                  <span className="tnum font-semibold text-brand-ink">{money(p.value)}</span>
                  <span className="tnum flex items-center gap-3 text-xs text-brand-gray">
                    {hrs > 0 && <span>{hrs.toFixed(1)}h logged</span>}
                    {p.due_date && <span>Due {shortDate(p.due_date)}</span>}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
