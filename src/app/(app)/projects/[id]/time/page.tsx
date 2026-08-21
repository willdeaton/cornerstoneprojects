import { listProjectTime, projectHours } from '@/lib/data';
import { loadProject, requireJobUser } from '../job';
import { ProjectTime } from '../ProjectTime';

export const dynamic = 'force-dynamic';

/** Every shift clocked against this job, and the total behind the header. */
export default async function ProjectTimePage({ params }: { params: Promise<{ id: string }> }) {
  await requireJobUser();
  const { id: idParam } = await params;
  const project = await loadProject(idParam);

  const [entries, hours] = await Promise.all([
    listProjectTime(project.id),
    projectHours(project.id),
  ]);

  return (
    <div className="max-w-3xl">
      <ProjectTime entries={entries} totalHours={hours} />
    </div>
  );
}
