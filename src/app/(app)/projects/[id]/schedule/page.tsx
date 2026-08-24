import { listSubcontractors, listHolidays, listScheduleTasks, getPublishedVersion, listScheduleChanges } from '@/lib/schedule-data';
import { loadProject, requireJobUser } from '../job';
import { ScheduleSection } from '../ScheduleSection';

export const dynamic = 'force-dynamic';

/**
 * This job's phases — the same planning surface as the Schedule page's timeline,
 * scoped to one job. Publishing and the hard finish date live here too, because
 * both are decisions about this job rather than about the week.
 */
export default async function ProjectSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireJobUser();
  const { id: idParam } = await params;
  const project = await loadProject(idParam);
  const id = project.id;

  const [tasks, holidays, subs, publication, changes] = await Promise.all([
    listScheduleTasks({ projectId: id }),
    listHolidays(),
    listSubcontractors({ activeOnly: true }),
    getPublishedVersion(id),
    listScheduleChanges(id),
  ]);

  return (
    <ScheduleSection
      project={{
        id: project.id,
        name: project.name,
        customer: project.customer,
        due_date: project.due_date,
        hard_finish_date: project.hard_finish_date,
        on_hold: project.on_hold,
        on_hold_reason: project.on_hold_reason,
        on_hold_since: project.on_hold_since,
      }}
      tasks={tasks}
      subs={subs.map((s) => ({ id: s.id, name: s.name, trade: s.trade }))}
      holidays={holidays.map((h) => h.day)}
      published={
        publication
          ? {
              version: publication.version,
              published_at: publication.published_at,
              published_by_name: publication.published_by_name ?? null,
              changeCount: changes.length,
            }
          : null
      }
      changes={changes}
      canUnpublish={user.role === 'admin'}
    />
  );
}
