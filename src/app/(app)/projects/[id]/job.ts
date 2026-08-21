import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser, type User } from '@/lib/auth';
import { getProject } from '@/lib/data';
import type { Project } from '@/lib/types';

/**
 * Shared loading for the tabs of one job.
 *
 * The layout draws the header from the project row and each tab page reads it
 * too, so `getProject` is wrapped in React's request cache: both get the row,
 * the database is asked once. Every tab calls `requireJobUser` for itself —
 * hiding a tab's link is not access control, so the page behind it re-checks.
 */

/** One project row per request, however many callers ask for it. */
export const loadProject = cache(async (idParam: string): Promise<Project> => {
  const id = Number(idParam);
  if (!Number.isFinite(id)) notFound();
  const project = await getProject(id);
  if (!project) notFound();
  return project;
});

/** Signed in, and not an employee — employees are time-clock only. */
export async function requireJobUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role === 'employee') redirect('/time');
  return user;
}

/**
 * The same gate the Billing tab and the invoice action use. A worker who types
 * the URL lands back on the job rather than on a page of somebody's A/R.
 */
export async function requireJobBiller(projectId: number): Promise<User> {
  const user = await requireJobUser();
  if (user.role !== 'admin' && user.role !== 'manager') redirect(`/projects/${projectId}`);
  return user;
}

export function canBill(user: User): boolean {
  return user.role === 'admin' || user.role === 'manager';
}
