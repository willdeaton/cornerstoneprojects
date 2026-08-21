import { listNotes } from '@/lib/data';
import { listCrewNotes } from '@/lib/schedule-data';
import { loadProject, requireJobUser } from '../job';
import { NotesSection } from '../NotesSection';
import { CrewNotesSection } from '../CrewNotesSection';

export const dynamic = 'force-dynamic';

/**
 * Two note lists that were previously stacked as look-alike cards on one long
 * page, which made it easy to write for the wrong audience. They are side by
 * side and labelled by who reads them now: internal notes stay in the office,
 * crew notes go out to everyone booked on the job and into the schedule email.
 */
export default async function ProjectNotesPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireJobUser();
  const { id: idParam } = await params;
  const project = await loadProject(idParam);

  const [notes, crewNotes] = await Promise.all([
    listNotes(project.id),
    listCrewNotes(project.id),
  ]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
    </div>
  );
}
