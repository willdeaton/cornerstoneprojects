import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  getProject,
  listNotes,
  listProjectTime,
  projectHours,
  activeEntry,
} from '@/lib/data';
import { money, shortDate } from '@/lib/format';
import { ProjectStatusBadge } from '@/components/ui';
import { StatusProgress } from './StatusProgress';
import { NotesSection } from './NotesSection';
import { ProjectTime } from './ProjectTime';
import { ProjectHeaderActions } from './ProjectHeaderActions';

export const dynamic = 'force-dynamic';

export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  const project = getProject(id);
  if (!project) notFound();

  const user = (await getCurrentUser())!;
  const notes = listNotes(id);
  const timeEntries = listProjectTime(id);
  const hours = projectHours(id);
  const active = activeEntry(user.id);
  const clockedInHere = active?.project_id === id;

  return (
    <div>
      <div className="mb-5">
        <Link href="/projects" className="text-sm font-medium text-brand-gray hover:text-brand-ink">
          ← Back to Projects
        </Link>
      </div>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
              {project.customer}
            </p>
            <ProjectStatusBadge status={project.status} />
          </div>
          <h1 className="brand-heading mt-1 text-2xl text-brand-ink sm:text-3xl">{project.name}</h1>
          <p className="mt-1 text-sm text-brand-gray">
            {project.category ?? 'Uncategorized'}
            {project.location ? ` · ${project.location}` : ''}
          </p>
        </div>
        <ProjectHeaderActions project={project} />
      </div>

      {/* Summary strip */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Contract Value" value={money(project.value)} />
        <Stat label="Hours Logged" value={`${hours.toFixed(1)}h`} />
        <Stat label="Start" value={shortDate(project.start_date)} />
        <Stat label="Due" value={shortDate(project.due_date)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: status + notes */}
        <div className="space-y-6 lg:col-span-2">
          <div className="card p-5">
            <h2 className="brand-heading mb-4 text-sm text-brand-gray">Status &amp; Progress</h2>
            <StatusProgress
              id={project.id}
              status={project.status}
              progress={project.progress}
            />
          </div>
          <NotesSection projectId={project.id} notes={notes} currentUserId={user.id} />
        </div>

        {/* Right: time clock */}
        <div>
          <ProjectTime
            projectId={project.id}
            entries={timeEntries}
            clockedInHere={clockedInHere}
            clockedInElsewhere={!!active && !clockedInHere}
            activeElsewhereName={active && !clockedInHere ? active.project_name : null}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">{label}</p>
      <p className="mt-1 text-lg font-bold text-brand-ink">{value}</p>
    </div>
  );
}
