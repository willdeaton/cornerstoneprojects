import Link from 'next/link';
import { listProjects, projectHours } from '@/lib/data';
import type { ProjectStatus } from '@/lib/types';
import { money, shortDate, duration } from '@/lib/format';
import { PageHeader, ProjectStatusBadge, ProgressBar, EmptyState } from '@/components/ui';
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

  return (
    <div>
      <PageHeader title="Active Projects" subtitle="Sold work and where it stands">
        <AddProjectButton />
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-black/10 bg-white p-1">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/projects?status=${t.key}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                filter === t.key ? 'bg-brand-green text-brand-ink' : 'text-brand-gray hover:bg-black/5'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <p className="text-sm text-brand-gray">
          <span className="font-semibold text-brand-ink">{projects.length}</span> jobs ·{' '}
          <span className="font-semibold text-brand-ink">{money(total)}</span>
        </p>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title="No projects here yet"
          hint="Sell a quote from the Open Quotes tab, or add a project directly."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const hrs = hoursById.get(p.id) ?? 0;
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="card group p-5 transition hover:shadow-card-hover"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold uppercase tracking-wide text-brand-gray">
                      {p.customer}
                    </p>
                    <h3 className="mt-0.5 font-semibold text-brand-ink group-hover:text-brand-green-dark">
                      {p.name}
                    </h3>
                  </div>
                  <ProjectStatusBadge status={p.status} />
                </div>

                <div className="mb-3">
                  <div className="mb-1 flex justify-between text-xs text-brand-gray">
                    <span>Progress</span>
                    <span className="font-semibold text-brand-ink">{p.progress}%</span>
                  </div>
                  <ProgressBar value={p.progress} />
                </div>

                <div className="flex items-center justify-between border-t border-black/5 pt-3 text-sm">
                  <span className="font-bold text-brand-ink">{money(p.value)}</span>
                  <span className="flex items-center gap-3 text-xs text-brand-gray">
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
