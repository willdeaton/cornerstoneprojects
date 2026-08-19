import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  getProject,
  listNotes,
  listProjectTime,
  projectHours,
  listProjectFiles,
  listProjectInvoices,
} from '@/lib/data';
import {
  listScheduleTasks,
  listHolidays,
  getPublishedVersion,
  listScheduleChanges,
  listCrewNotes,
} from '@/lib/schedule-data';
import { computeSchedule, projectedEnd } from '@/lib/schedule-math';
import { money, shortDate } from '@/lib/format';
import { ProjectStatusBadge } from '@/components/ui';
import { StatusProgress } from './StatusProgress';
import { NotesSection } from './NotesSection';
import { ProjectTime } from './ProjectTime';
import { ProjectHeaderActions } from './ProjectHeaderActions';
import { ProjectFiles } from './ProjectFiles';
import { InvoiceSection } from './InvoiceSection';
import { ScheduleSection } from './ScheduleSection';
import { CrewNotesSection } from './CrewNotesSection';

export const dynamic = 'force-dynamic';

export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role === 'employee') redirect('/time');

  const { id: idStr } = await params;
  const id = Number(idStr);
  const project = await getProject(id);
  if (!project) notFound();

  const notes = await listNotes(id);
  const timeEntries = await listProjectTime(id);
  const hours = await projectHours(id);
  const files = await listProjectFiles(id);
  const invoices = await listProjectInvoices(id);
  const [scheduleTasks, holidays, publication, scheduleChanges, crewNotes] = await Promise.all([
    listScheduleTasks({ projectId: id }),
    listHolidays(),
    getPublishedVersion(id),
    listScheduleChanges(id),
    listCrewNotes(id),
  ]);
  const holidayDays = holidays.map((h) => h.day);
  // Projected finish = the latest end across the scheduled phases, chains resolved.
  const projectedFinish = projectedEnd(
    scheduleTasks.map((t) => t.id),
    computeSchedule(scheduleTasks, { holidays: new Set(holidayDays) }).windows
  );

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

      {/* Summary strip */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-7">
        <Stat label="Contract Value" value={money(project.value)} />
        <Stat label="Hours Logged" value={`${hours.toFixed(1)}h`} />
        <Stat label="Start" value={shortDate(project.start_date)} />
        <Stat label="End" value={shortDate(project.end_date)} />
        <Stat
          label="Projected Finish"
          value={shortDate(projectedFinish)}
          alert={
            !!(
              projectedFinish &&
              ((project.due_date && projectedFinish > project.due_date) ||
                (project.hard_finish_date && projectedFinish > project.hard_finish_date))
            )
          }
        />
        <Stat label="Due" value={shortDate(project.due_date)} />
        <Stat
          label="Must Finish By"
          value={shortDate(project.hard_finish_date)}
          alert={
            !!(
              projectedFinish &&
              project.hard_finish_date &&
              projectedFinish > project.hard_finish_date
            )
          }
        />
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

          <ScheduleSection
            project={{
              id: project.id,
              name: project.name,
              customer: project.customer,
              due_date: project.due_date,
              hard_finish_date: project.hard_finish_date,
            }}
            tasks={scheduleTasks}
            holidays={holidayDays}
            published={
              publication
                ? {
                    version: publication.version,
                    published_at: publication.published_at,
                    published_by_name: publication.published_by_name ?? null,
                    changeCount: scheduleChanges.length,
                  }
                : null
            }
            changes={scheduleChanges}
            canUnpublish={user.role === 'admin'}
          />

          <CrewNotesSection projectId={project.id} notes={crewNotes} />

          <InvoiceSection project={project} invoices={invoices} />

          <NotesSection projectId={project.id} notes={notes} currentUserId={user.id} />
        </div>

        {/* Right: time summary + files */}
        <div className="space-y-6">
          <ProjectTime entries={timeEntries} totalHours={hours} />
          <ProjectFiles projectId={project.id} files={files} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">{label}</p>
      <p className={`mt-1 text-lg font-bold ${alert ? 'text-amber-700' : 'text-brand-ink'}`}>
        {value}
      </p>
    </div>
  );
}
