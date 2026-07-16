'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { clockIn, clockOut } from '@/lib/data';

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function clockInAction(projectId: number) {
  const user = await requireUser();
  const res = clockIn(user.id, projectId);
  revalidatePath('/time');
  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/', 'layout');
  return res;
}

export async function clockOutAction(note?: string) {
  const user = await requireUser();
  const res = clockOut(user.id, note);
  revalidatePath('/time');
  revalidatePath('/projects');
  revalidatePath('/', 'layout');
  return res;
}
