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
  const id = createProject({
    customer,
    name,
    category: String(formData.get('category') ?? '').trim() || null,
    value: isNaN(value) ? 0 : value,
    status: (String(formData.get('status') ?? 'not_started') as ProjectStatus) || 'not_started',
    location: String(formData.get('location') ?? '').trim() || null,
    start_date: String(formData.get('start_date') ?? '') || null,
    due_date: String(formData.get('due_date') ?? '') || null,
  });
  revalidatePath('/projects');
  revalidatePath('/dashboard');
  redirect(`/projects/${id}`);
}

export async function setProjectStatusAction(id: number, status: ProjectStatus) {
  await requireUser();
  const progress = status === 'completed' ? 100 : status === 'not_started' ? 0 : undefined;
  updateProject(id, progress != null ? { status, progress } : { status });
  revalidatePath(`/projects/${id}`);
  revalidatePath('/projects');
  revalidatePath('/dashboard');
}

export async function setProjectProgressAction(id: number, progress: number) {
  await requireUser();
  updateProject(id, { progress: Math.max(0, Math.min(100, progress)) });
  revalidatePath(`/projects/${id}`);
  revalidatePath('/projects');
}

export async function updateProjectDetailsAction(id: number, formData: FormData) {
  await requireUser();
  const value = parseFloat(String(formData.get('value') ?? '0').replace(/[$,]/g, ''));
  updateProject(id, {
    name: String(formData.get('name') ?? '').trim() || undefined,
    category: String(formData.get('category') ?? '').trim() || null,
    value: isNaN(value) ? undefined : value,
    location: String(formData.get('location') ?? '').trim() || null,
    start_date: String(formData.get('start_date') ?? '') || null,
    due_date: String(formData.get('due_date') ?? '') || null,
  });
  revalidatePath(`/projects/${id}`);
  revalidatePath('/projects');
  revalidatePath('/dashboard');
}

export async function deleteProjectAction(id: number) {
  await requireUser();
  deleteProject(id);
  revalidatePath('/projects');
  revalidatePath('/dashboard');
  redirect('/projects');
}

export async function addNoteAction(projectId: number, formData: FormData) {
  const user = await requireUser();
  const body = String(formData.get('body') ?? '').trim();
  if (!body) return;
  addNote(projectId, user.id, user.name, body);
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteNoteAction(projectId: number, noteId: number) {
  await requireUser();
  deleteNote(noteId);
  revalidatePath(`/projects/${projectId}`);
}
