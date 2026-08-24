import Link from 'next/link';
import { money, shortDate } from '@/lib/format';
import { OnHoldBadge, ProjectStatusBadge } from '@/components/ui';
import { BackToList } from '@/components/ListMemory';
import { loadProject, requireJobUser } from './job';
import { tabsForRole } from './project-tabs';
import { ProjectTabs } from './ProjectTabs';
import { ProjectHeaderActions } from './ProjectHeaderActions';

export const dynamic = 'force-dynamic';

/**
 * The frame every tab of a job shares: who the job is for, what it's worth,
 * the two dates that don't move, and the tabs themselves.
 *
 * Deliberately only project-row data. Anything that needs another table —
 * hours logged, the projected finish off the phase chain, what's been invoiced
 * — belongs to the tab that owns it, so opening Files doesn't pay for the
 * schedule solver.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const user = await requireJobUser();
  const { id } = await params;
  const project = await loadProject(id);

  return (
    <div>
      <div className="mb-5">
        <BackToList
          listKey="projects"
          fallback="/projects"
          className="text-sm font-medium text-brand-gray hover:text-brand-ink"
        >
          ← Back to Projects
        </BackToList>
      </div>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
              {project.customer}
            </p>
            <ProjectStatusBadge status={project.status} />
            {/* Beside the status, never instead of it: a held job is still not
                started or still in progress, and losing that would hide where
                the work had actually got to. */}
            {project.on_hold && (
              <OnHoldBadge reason={project.on_hold_reason} since={project.on_hold_since} />
            )}
          </div>
          <h1 className="brand-heading mt-1 text-2xl text-brand-ink sm:text-3xl">{project.name}</h1>
          <p className="mt-1 text-sm text-brand-gray">
            {project.category ?? 'Uncategorized'}
            {project.location ? ` · ${project.location}` : ''}
            {project.quote_number ? (
              <>
                {' · Quote '}
                {project.quote_id ? (
                  <Link
                    href={`/quotes/${project.quote_id}/edit`}
                    className="font-medium text-brand-green-dark underline underline-offset-2 hover:text-brand-ink"
                  >
                    {project.quote_number}
                  </Link>
                ) : (
                  project.quote_number
                )}
              </>
            ) : (
              ''
            )}
          </p>
          {project.site_address && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                project.site_address
              )}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block text-sm font-medium text-brand-green-dark hover:underline"
              title="Directions to the job site"
            >
              {project.site_address}
            </a>
          )}
        </div>
        <ProjectHeaderActions project={project} />
      </div>

      {/* Carried across every tab: what the job is worth, and the two dates it
          is answerable to. The planned and projected dates live on Overview,
          next to the phases they come from. */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <HeaderStat label="Contract Value" value={money(project.value)} />
        <HeaderStat label="Progress" value={`${project.progress}%`} />
        <HeaderStat label="Due" value={shortDate(project.due_date)} />
        <HeaderStat
          label="Must Finish By"
          value={shortDate(project.hard_finish_date)}
          hint={project.hard_finish_date ? 'Committed' : undefined}
        />
      </div>

      <ProjectTabs projectId={project.id} tabs={tabsForRole(user.role)} />

      {children}
    </div>
  );
}

function HeaderStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">{label}</p>
      <p className="mt-1 text-lg font-bold text-brand-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-brand-gray">{hint}</p>}
    </div>
  );
}
