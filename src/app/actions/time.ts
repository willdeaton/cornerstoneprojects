'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isValidSynopsis, SYNOPSIS_ERROR } from '@/lib/synopsis';
import {
  clockIn,
  clockOut,
  switchJob,
  startBreak,
  endBreak,
  setEntryPaid,
  setWeekPaid,
  approveWeek,
  getTimeEntry,
  addManualTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
} from '@/lib/data';

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== 'admin') {
    return null;
  }
  return user;
}

/** Approving a week is a manager responsibility, so it stays open to managers
 *  as well as admins — unlike paid-marking, which is admin-only. */
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
  // A shift synopsis is required to clock out (also enforced in clockOut).
  if (!isValidSynopsis(note)) {
    return { ok: false, error: SYNOPSIS_ERROR };
  }
  const res = await clockOut(user.id, note);
  revalidatePath('/time');
  revalidatePath('/projects');
  revalidatePath('/', 'layout');
  return res;
}

/** Switch jobs mid-shift: closes the current segment (with an optional note)
 *  and opens a new open entry on the target job, all in one transaction so
 *  the clock keeps running. */
export async function switchJobAction(projectId: number | null, note?: string) {
  const user = await requireUser();
  const res = await switchJob(user.id, projectId, note);
  revalidatePath('/time');
  revalidatePath('/projects');
  if (projectId) revalidatePath(`/projects/${projectId}`);
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

/** Only admins may mark shifts paid. */
export async function setEntryPaidAction(
  entryId: number,
  paid: boolean
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: 'Not authorized.' };
  await setEntryPaid(entryId, paid, user.id);
  revalidatePath('/timesheets');
  return { ok: true };
}

/** Only admins may mark a week paid; an optional check number is recorded on
 *  the week's entries when marking paid. */
export async function setWeekPaidAction(
  userId: number,
  weekStart: string,
  paid: boolean,
  checkNumber?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: 'Not authorized.' };
  await setWeekPaid(userId, weekStart, paid, user.id, checkNumber);
  revalidatePath('/timesheets');
  return { ok: true };
}

/** Sign off one employee's week from inside the app. Approval is independent
 *  of paid-marking — it never blocks or requires it. */
export async function approveWeekAction(userId: number, weekStart: string) {
  const user = await requireManager();
  if (!user) return { ok: false, error: 'Not authorized.' };
  await approveWeek(userId, weekStart, user.id, 'app');
  revalidatePath('/timesheets');
  return { ok: true };
}

interface TimeEntryInput {
  projectId: number | null;
  clockIn: string;
  clockOut: string;
  note?: string | null;
  breakMinutes?: number;
}

/** Add a backdated / manual time entry. Managers may log time for anyone by
 *  passing `userId`; everyone else can only log their own time. */
export async function addTimeEntryAction(input: TimeEntryInput & { userId?: number }) {
  const user = await requireUser();
  const manager = user.role === 'admin' || user.role === 'manager';
  if (!manager && input.userId && input.userId !== user.id) {
    return { ok: false, error: 'Not authorized to add time for other people.' };
  }
  const targetUserId = manager && input.userId ? input.userId : user.id;

  const res = await addManualTimeEntry({
    userId: targetUserId,
    projectId: input.projectId,
    clockIn: input.clockIn,
    clockOut: input.clockOut,
    note: input.note,
    breakMinutes: input.breakMinutes,
  });

  revalidatePath('/time');
  revalidatePath('/timesheets');
  if (input.projectId) revalidatePath(`/projects/${input.projectId}`);
  revalidatePath('/', 'layout');
  return res;
}

/** Edit an existing entry's times, job, note and break. Employees may only edit
 *  their own shifts, and not once they've been marked paid. */
export async function updateTimeEntryAction(input: TimeEntryInput & { entryId: number }) {
  const user = await requireUser();
  const entry = await getTimeEntry(input.entryId);
  if (!entry) return { ok: false, error: 'That time entry no longer exists.' };

  const manager = user.role === 'admin' || user.role === 'manager';
  if (!manager) {
    if (entry.user_id !== user.id) return { ok: false, error: 'Not authorized.' };
    if (entry.paid) {
      return { ok: false, error: 'This shift is already marked paid. Ask a manager to change it.' };
    }
  }

  const res = await updateTimeEntry({
    entryId: input.entryId,
    projectId: input.projectId,
    clockIn: input.clockIn,
    clockOut: input.clockOut,
    note: input.note,
    breakMinutes: input.breakMinutes,
  });

  revalidatePath('/time');
  revalidatePath('/timesheets');
  if (entry.project_id) revalidatePath(`/projects/${entry.project_id}`);
  if (input.projectId) revalidatePath(`/projects/${input.projectId}`);
  revalidatePath('/', 'layout');
  return res;
}

/** Delete a time entry. Same permission rules as editing. */
export async function deleteTimeEntryAction(entryId: number) {
  const user = await requireUser();
  const entry = await getTimeEntry(entryId);
  if (!entry) return { ok: false, error: 'That time entry no longer exists.' };

  const manager = user.role === 'admin' || user.role === 'manager';
  if (!manager) {
    if (entry.user_id !== user.id) return { ok: false, error: 'Not authorized.' };
    if (entry.paid) {
      return { ok: false, error: 'This shift is already marked paid. Ask a manager to change it.' };
    }
  }

  await deleteTimeEntry(entryId);

  revalidatePath('/time');
  revalidatePath('/timesheets');
  if (entry.project_id) revalidatePath(`/projects/${entry.project_id}`);
  revalidatePath('/', 'layout');
  return { ok: true };
}
