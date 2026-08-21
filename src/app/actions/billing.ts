'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { setProjectBillingHold, setProjectBillingClosed } from '@/lib/data';

/**
 * The billing desk. Only admins and managers get here — the A/R on every job
 * is not something an employee has any business seeing, which is the same line
 * Settings draws.
 */
async function requireBiller() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin' && user.role !== 'manager') throw new Error('Not authorized.');
  return user;
}

/** Every view a billing change can show up in. */
function revalidateBilling(projectId: number) {
  revalidatePath('/billing');
  revalidatePath(`/projects/${projectId}`, 'layout');
  revalidatePath('/projects');
}

/**
 * Park a job's billing, or put it back in the queue. A hold has to say why:
 * the whole point is that the next person through the queue knows why nobody
 * is chasing this one, so an empty reason is rejected rather than saved.
 */
export async function setBillingHoldAction(
  projectId: number,
  hold: boolean,
  reason: string
): Promise<{ error?: string }> {
  await requireBiller();
  const trimmed = reason.trim();
  if (hold && !trimmed) return { error: 'Say why billing is on hold.' };
  await setProjectBillingHold(projectId, hold, trimmed || null);
  revalidateBilling(projectId);
  return {};
}

/**
 * Sign a job off the billing desk, or reopen it. Closing is deliberately
 * allowed whatever the invoices say — a no-charge job closes with nothing
 * raised, and a written-off balance still needs to leave the queue — so the
 * page warns about an outstanding balance rather than blocking the close.
 */
export async function setBillingClosedAction(
  projectId: number,
  closed: boolean
): Promise<{ error?: string }> {
  const user = await requireBiller();
  await setProjectBillingClosed(projectId, closed, closed ? user.id : null);
  revalidateBilling(projectId);
  return {};
}
