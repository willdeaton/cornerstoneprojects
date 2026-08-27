import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser, type User } from '@/lib/auth';
import { getProject, getProjectSyncPair, listProjectInvoices } from '@/lib/data';
import {
  buildQuoteSyncState,
  hasQuoteSyncDrift,
  quoteSyncDiff,
  type QuoteSyncState,
} from '@/lib/quote-sync';
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
 * The same gate the Billing tab and the invoice action use. With the role set at
 * admin / manager / employee this is defence in depth rather than a live filter
 * — `requireJobUser` has already turned employees away, so everybody still here
 * can bill. It stays because hiding the tab's link is not access control: any
 * role added between manager and employee gets sent back to the job rather than
 * onto a page of somebody's A/R.
 */
export async function requireJobBiller(projectId: number): Promise<User> {
  const user = await requireJobUser();
  if (user.role !== 'admin' && user.role !== 'manager') redirect(`/projects/${projectId}`);
  return user;
}

export function canBill(user: User): boolean {
  return user.role === 'admin' || user.role === 'manager';
}

/**
 * The post-sale quote revision waiting on this job, if there is one.
 *
 * Cached per request for the same reason `loadProject` is: the job's frame
 * flags it on every tab and the Billing tab shows it again beside the money it
 * would move, and one disagreement should cost one lookup. Returns `null` for
 * the overwhelmingly common case — a job whose quote hasn't been touched since
 * it sold — so the extra cost on a normal page load is two indexed reads.
 *
 * Employees never see it: they never reach these pages, and the loader says so
 * itself rather than trusting that.
 */
export const loadQuoteRevision = cache(
  async (projectId: number): Promise<QuoteSyncState | null> => {
    const user = await getCurrentUser();
    if (!user || user.role === 'employee') return null;
    const pair = await getProjectSyncPair(projectId);
    if (!pair) return null;
    // Decided in memory first: a job whose quote hasn't been touched is the
    // normal case, and it must not cost this page an invoice read per tab.
    if (!hasQuoteSyncDrift(quoteSyncDiff(pair.quote, pair.project))) return null;
    const invoices = await listProjectInvoices(pair.project.id);
    return buildQuoteSyncState(pair.quote, pair.project, invoices, user.role);
  }
);
