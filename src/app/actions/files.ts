'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  addProjectFile,
  deleteProjectFile,
  getProjectFile,
  addQuoteFile,
  deleteQuoteFile,
  getQuoteFile,
} from '@/lib/data';

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Employees are time-clock-only — they may never touch project/quote files.
  if (user.role === 'employee') throw new Error('Not authorized.');
  return user;
}

export interface FileUploadState {
  error?: string;
  success?: string;
}

const MAX_BYTES = 10_000_000; // 10 MB

/**
 * Upload one or more files to a project. The picker and the drop zone both
 * allow multiple files, so every `file` entry on the form is stored. Oversized
 * files are skipped rather than failing the whole batch, and are named back to
 * the user so it's clear what didn't make it.
 */
export async function uploadProjectFileAction(
  _prev: FileUploadState,
  formData: FormData
): Promise<FileUploadState> {
  const user = await requireUser();
  const projectId = Number(formData.get('project_id'));
  if (!projectId) return { error: 'Missing project.' };

  const files = formData.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: 'Choose a file to upload.' };

  const uploaded: string[] = [];
  const tooBig: string[] = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      tooBig.push(file.name || 'upload');
      continue;
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || 'application/octet-stream';
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;

    await addProjectFile({
      project_id: projectId,
      filename: file.name || 'upload',
      mime,
      size: file.size,
      data: dataUrl,
      uploaded_by: user.id,
      uploader_name: user.name,
    });
    uploaded.push(file.name || 'upload');
  }

  revalidatePath(`/projects/${projectId}`, 'layout');

  if (uploaded.length === 0) {
    return { error: `Each file must be under 10 MB — skipped ${tooBig.join(', ')}.` };
  }
  const success =
    uploaded.length === 1 ? `Uploaded ${uploaded[0]}.` : `Uploaded ${uploaded.length} files.`;
  return tooBig.length
    ? { success, error: `Skipped (over 10 MB): ${tooBig.join(', ')}.` }
    : { success };
}

export async function deleteProjectFileAction(fileId: number, projectId: number) {
  await requireUser();
  const file = await getProjectFile(fileId);
  if (file && file.project_id === projectId) {
    await deleteProjectFile(fileId);
  }
  revalidatePath(`/projects/${projectId}`, 'layout');
}

/* ------------------------------------------- Quote supporting documentation */

/**
 * Upload one or more supporting documents to a quote (internal reference only —
 * they are never shown on the customer-facing PDF). Mirrors the project
 * uploader: the picker and the drop zone both take several files at once, and
 * an oversized file is skipped and named back rather than failing the batch.
 */
export async function uploadQuoteFileAction(
  _prev: FileUploadState,
  formData: FormData
): Promise<FileUploadState> {
  const user = await requireUser();
  const quoteId = Number(formData.get('quote_id'));
  if (!quoteId) return { error: 'Missing quote.' };

  const files = formData.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: 'Choose a file to upload.' };

  const uploaded: string[] = [];
  const tooBig: string[] = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      tooBig.push(file.name || 'upload');
      continue;
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || 'application/octet-stream';
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;

    await addQuoteFile({
      quote_id: quoteId,
      filename: file.name || 'upload',
      mime,
      size: file.size,
      data: dataUrl,
      uploaded_by: user.id,
      uploader_name: user.name,
    });
    uploaded.push(file.name || 'upload');
  }

  revalidatePath(`/quotes/${quoteId}/edit`);

  if (uploaded.length === 0) {
    return { error: `Each file must be under 10 MB — skipped ${tooBig.join(', ')}.` };
  }
  const success =
    uploaded.length === 1 ? `Uploaded ${uploaded[0]}.` : `Uploaded ${uploaded.length} files.`;
  return tooBig.length
    ? { success, error: `Skipped (over 10 MB): ${tooBig.join(', ')}.` }
    : { success };
}

export async function deleteQuoteFileAction(fileId: number, quoteId: number) {
  await requireUser();
  const file = await getQuoteFile(fileId);
  if (file && file.quote_id === quoteId) {
    await deleteQuoteFile(fileId);
  }
  revalidatePath(`/quotes/${quoteId}/edit`);
}
