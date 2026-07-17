'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  clockIn,
  clockOut,
  startBreak,
  endBreak,
  setEntryPaid,
  setWeekPaid,
} from '@/lib/data';

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

async function requireManager() {
  const user = await requireUser();
  if (user.role !== 'admin' && user.role !== 'manager') {
    return null;
  }
  return user;
}

/** Clock in. Pass a projectId to tie the shift to a job, or null for a
 *  general clock-in that isn't tied to any specific job. */
export async function clockInAction(projectId: number | null) {
  const user = await requireUser();
  const res = await clockIn(user.id, projectId);
  revalidatePath('/time');
  if (projectId) revalidatePath(`/projects/${projectId}`);
  revalidatePath('/', 'layout');
  return res;
}

export async function clockOutAction(note?: string) {
  const user = await requireUser();
  const res = await clockOut(user.id, note);
  revalidatePath('/time');
  revalidatePath('/projects');
  revalidatePath('/', 'layout');
  return res;
}

export async function startBreakAction() {
  const user = await requireUser();
  const res = await startBreak(user.id);
  revalidatePath('/time');
  revalidatePath('/', 'layout');
  return res;
}

export async function endBreakAction() {
  const user = await requireUser();
  const res = await endBreak(user.id);
  revalidatePath('/time');
  revalidatePath('/', 'layout');
  return res;
}

export async function setEntryPaidAction(entryId: number, paid: boolean) {
  const user = await requireManager();
  if (!user) return { ok: false, error: 'Not authorized.' };
  await setEntryPaid(entryId, paid, user.id);
  revalidatePath('/timesheets');
  return { ok: true };
}

export async function setWeekPaidAction(userId: number, weekStart: string, paid: boolean) {
  const user = await requireManager();
  if (!user) return { ok: false, error: 'Not authorized.' };
  await setWeekPaid(userId, weekStart, paid, user.id);
  revalidatePath('/timesheets');
  return { ok: true };
}
