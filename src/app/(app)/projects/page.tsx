import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listProjects, projectHours, listInvoiceTallies } from '@/lib/data';
import { billingSummary, EMPTY_TALLY, type InvoiceTally } from '@/lib/billing';
import type { ProjectStatus } from '@/lib/types';
import { PageHeader } from '@/components/ui';
import { ListMemory } from '@/components/ListMemory';
import { PrintButton } from '@/components/print';
import { AddProjectButton } from './AddProjectButton';
import { ProjectsTable, type ProjectRow } from './ProjectsTable';

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

  const hoursById = new Map(
    await Promise.all(projects.map(async (p) => [p.id, await projectHours(p.id)] as const))
  );
  // Billing is an admin/manager concern, same as the Billing page itself.
  const canBill = me.role === 'admin' || me.role === 'manager';
  const tallies: Map<number, InvoiceTally> = canBill
    ? await listInvoiceTallies(projects.map((p) => p.id))
    : new Map();

  // Flattened here so the table gets one plain, sortable array — the client
  // side has no business re-deriving billing stages.
  const rows: ProjectRow[] = projects.map((p) => {
    const billing = canBill ? billingSummary(p, tallies.get(p.id) ?? EMPTY_TALLY) : null;
    return {
      id: p.id,
      customer: p.customer,
      name: p.name,
      quote_number: p.quote_number,
      category: p.category,
      location: p.location,
      value: p.value,
      status: p.status,
      progress: p.progress,
      due_date: p.due_date,
      on_hold: p.on_hold,
      on_hold_reason: p.on_hold_reason,
      on_hold_since: p.on_hold_since,
      hours: hoursById.get(p.id) ?? 0,
      billing: billing
        ? { stage: billing.stage, urgency: billing.urgency, outstanding: billing.outstanding }
        : null,
    };
  });

  return (
    // The list is columns-wide, not paragraphs-wide, so it prints landscape.
    <div className="print-landscape">
      {/* Remembers this tab + scroll offset so "← Back to Projects" lands here. */}
      <ListMemory listKey="projects" />
      <PageHeader title="Projects" subtitle="Sold work and where it stands">
        {/* Prints the list exactly as it stands — tab, filters, sort and all. */}
        <PrintButton title="Print the project list" />
        <AddProjectButton />
      </PageHeader>

      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
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
      </div>

      <ProjectsTable
        rows={rows}
        canBill={canBill}
        tabLabel={TABS.find((t) => t.key === filter)?.label ?? 'All'}
      />
    </div>
  );
}
