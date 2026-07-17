'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import type { ProjectStatus } from '@/lib/types';
import {
  createProject,
  updateProject,
  deleteProject,
  addNote,
  deleteNote,
} from '@/lib/data';
import { notifyScheduleChange } from '@/lib/email/send';

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function createProjectAction(formData: FormData) {
  await requireUser();
  const customer = String(formData.get('customer') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const value = parseFloat(String(formData.get('value') ?? '0').replace(/[$,]/g, ''));
  if (!customer || !name) return;
  const id = await createProject({
    customer,
    name,
    quote_number: String(formData.get('quote_number') ?? '').trim() || null,
    category: String(formData.get('category') ?? '').trim() || null,
    value: isNaN(value) ? 0 : value,
    status: (String(formData.get('status') ?? 'not_started') as ProjectStatus) || 'not_started',
    location: String(formData.get('location') ?? '').trim() || null,
    start_date: String(formData.get('start_date') ?? '') || null,
    end_date: String(formData.get('end_date') ?? '') || null,
    due_date: String(formData.get('due_date') ?? '') || null,
  });
  revalidatePath('/projects');
  revalidatePath('/dashboard');
  redirect(`/projects/${id}`);
}

export async function setProjectStatusAction(id: number, status: ProjectStatus) {
  await requireUser();
  const progress = status === 'completed' ? 100 : status === 'not_started' ? 0 : undefined;
  await updateProject(id, progress != null ? { status, progress } : { status });
  // Best-effort schedule-change notification; must not block the status update.
  await notifyScheduleChange(id);
  revalidatePath(`/projects/${id}`);
  revalidatePath('/projects');
  revalidatePath('/dashboard');
}

export async function setProjectProgressAction(id: number, progress: number) {
  await requireUser();
  await updateProject(id, { progress: Math.max(0, Math.min(100, progress)) });
  revalidatePath(`/projects/${id}`);
  revalidatePath('/projects');
}

export async function updateProjectDetailsAction(id: number, formData: FormData) {
  await requireUser();
  const value = parseFloat(String(formData.get('value') ?? '0').replace(/[$,]/g, ''));
  await updateProject(id, {
    name: String(formData.get('name') ?? '').trim() || undefined,
    quote_number: String(formData.get('quote_number') ?? '').trim() || null,
    category: String(formData.get('category') ?? '').trim() || null,
    value: isNaN(value) ? undefined : value,
    location: String(formData.get('location') ?? '').trim() || null,
    start_date: String(formData.get('start_date') ?? '') || null,
    end_date: String(formData.get('end_date') ?? '') || null,
    due_date: String(formData.get('due_date') ?? '') || null,
    invoice_numbers: String(formData.get('invoice_numbers') ?? '').trim() || null,
    invoice_notes: String(formData.get('invoice_notes') ?? '').trim() || null,
  });
  // Best-effort schedule-change notification; must not block the save. Only
  // recipients whose schedule signature actually changed will be emailed.
  await notifyScheduleChange(id);
  revalidatePath(`/projects/${id}`);
  revalidatePath('/projects');
  revalidatePath('/dashboard');
}

export async function deleteProjectAction(id: number) {
  await requireUser();
  await deleteProject(id);
  revalidatePath('/projects');
  revalidatePath('/dashboard');
  redirect('/projects');
}

export async function addNoteAction(projectId: number, formData: FormData) {
  const user = await requireUser();
  const body = String(formData.get('body') ?? '').trim();
  if (!body) return;
  await addNote(projectId, user.id, user.name, body);
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteNoteAction(projectId: number, noteId: number) {
  await requireUser();
  await deleteNote(noteId);
  revalidatePath(`/projects/${projectId}`);
}
