import { listProjectFiles } from '@/lib/data';
import { loadProject, requireJobUser } from '../job';
import { ProjectFiles } from '../ProjectFiles';

export const dynamic = 'force-dynamic';

/** Documents attached to this job. */
export default async function ProjectFilesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireJobUser();
  const { id: idParam } = await params;
  const project = await loadProject(idParam);
  const files = await listProjectFiles(project.id);

  return (
    <div className="max-w-3xl">
      <ProjectFiles projectId={project.id} files={files} />
    </div>
  );
}
