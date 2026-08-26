import type { Role } from '@/lib/auth';

/**
 * The tabs of one job's page.
 *
 * The job page used to be a single scroll carrying eight cards — status,
 * phases, crew notes, billing, invoices, notes, time and files — which meant
 * every visit loaded all of it and every concern was one card away from a
 * concern it had nothing to do with. Each tab is its own route now, loading
 * only its own rows.
 *
 * Where two of them were one errand they were put back together: Notes & Files
 * carries the internal notes, the crew notes and the job's attachments, because
 * "what happened on this job" and "the paperwork that came with it" are looked
 * at in the same visit — the photo of the damage and the note explaining it
 * were never two tabs' worth of concern.
 *
 * `managerOnly` is the tab's real access rule, applied by the tab's own page as
 * well as read here, so a hidden tab is also an unreachable one. Nothing is
 * gated by hiding a link alone.
 */
export interface ProjectTab {
  /** Appended to /projects/[id] — empty string is the overview itself. */
  segment: string;
  label: string;
  /** Admins and managers only (billing, and the money behind it). */
  managerOnly?: boolean;
}

export const PROJECT_TABS: ProjectTab[] = [
  { segment: '', label: 'Overview' },
  { segment: 'schedule', label: 'Schedule' },
  { segment: 'billing', label: 'Billing', managerOnly: true },
  { segment: 'time', label: 'Time' },
  // Notes and files are one tab: what was said about the job and the paperwork
  // that came with it are the same errand. `/projects/[id]/files` still exists
  // and redirects here, so links from before the merge keep working.
  { segment: 'notes', label: 'Notes & Files' },
  { segment: 'receipts', label: 'Receipts', managerOnly: true },
];

/** Whether a role may open a given tab. */
export function canSeeTab(tab: ProjectTab, role: Role): boolean {
  if (!tab.managerOnly) return true;
  return role === 'admin' || role === 'manager';
}

/** The tabs a role actually gets. */
export function tabsForRole(role: Role): ProjectTab[] {
  return PROJECT_TABS.filter((t) => canSeeTab(t, role));
}

export function tabHref(projectId: number, tab: ProjectTab): string {
  return tab.segment ? `/projects/${projectId}/${tab.segment}` : `/projects/${projectId}`;
}
