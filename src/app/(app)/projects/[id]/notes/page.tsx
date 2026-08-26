import { listNotes, listProjectFiles } from '@/lib/data';
import { listCrewNotes } from '@/lib/schedule-data';
import { loadProject, requireJobUser } from '../job';
import { NotesSection } from '../NotesSection';
import { CrewNotesSection } from '../CrewNotesSection';
import { ProjectFiles } from '../ProjectFiles';

export const dynamic = 'force-dynamic';

/**
 * Everything said about the job, and everything attached to it.
 *
 * The two note lists were previously stacked as look-alike cards on one long
 * page, which made it easy to write for the wrong audience; they are side by
 * side and labelled by who reads them now — internal notes stay in the office,
 * crew notes go out to everyone booked on the job and into the schedule email.
 *
 * The files were their own tab until they joined them here. They are the same
 * errand: a photo of the damage and the note explaining it get looked at in one
 * visit, and having to leave the page for the other half was the only thing
 * separating them. `/projects/[id]/files` redirects here so older links land in
 * the right place.
 */
export default async function ProjectNotesPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireJobUser();
  const { id: idParam } = await params;
  const project = await loadProject(idParam);

  const [notes, crewNotes, files] = await Promise.all([
    listNotes(project.id),
    listCrewNotes(project.id),
    listProjectFiles(project.id),
  ]);

  return (
    // Three columns where there is room for them; two while there isn't, with
    // the files running the full width underneath rather than sitting in a
    // half-column of their own — the drop zone wants the space.
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">
          Internal — office only
        </p>
        <NotesSection projectId={project.id} notes={notes} currentUserId={user.id} />
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-green-dark">
          Read by the crew — shows on their schedule and in the schedule email
        </p>
        <CrewNotesSection projectId={project.id} notes={crewNotes} />
      </div>
      <div className="lg:col-span-2 xl:col-span-1">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">
          Attached to this job — photos, plans, signed paperwork
        </p>
        <ProjectFiles projectId={project.id} files={files} />
      </div>
    </div>
  );
}
