import { redirect } from 'next/navigation';

/**
 * The files are on the Notes & Files tab now — what was said about a job and
 * the paperwork that came with it are one errand, and they were two tabs.
 *
 * The route stays as a redirect rather than being deleted: it has been linked
 * to from emails, bookmarks and older pages, and a dead job link is a worse
 * answer than the page the files actually live on.
 */
export default async function ProjectFilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/notes`);
}
