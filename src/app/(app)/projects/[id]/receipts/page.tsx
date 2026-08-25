import { listProjectReceipts } from '@/lib/data';
import { loadProject, requireJobBiller } from '../job';
import { ProjectReceipts } from '../ProjectReceipts';

export const dynamic = 'force-dynamic';

/**
 * What this job cost — the receipts against it.
 *
 * Gated with requireJobBiller, the same line the Billing tab draws: what a job
 * cost is the other half of what it was sold for. Hiding the tab's link is not
 * access control, so this re-checks for itself.
 */
export default async function ProjectReceiptsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const project = await loadProject(idParam);
  await requireJobBiller(project.id);
  const receipts = await listProjectReceipts(project.id);

  return <ProjectReceipts projectId={project.id} receipts={receipts} />;
}
