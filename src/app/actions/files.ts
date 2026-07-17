'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { addProjectFile, deleteProjectFile, getProjectFile } from '@/lib/data';

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export interface FileUploadState {
  error?: string;
  success?: string;
}

const MAX_BYTES = 10_000_000; // 10 MB

export async function uploadProjectFileAction(
  _prev: FileUploadState,
  formData: FormData
): Promise<FileUploadState> {
  const user = await requireUser();
  const projectId = Number(formData.get('project_id'));
  if (!projectId) return { error: 'Missing project.' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a file to upload.' };
  }
  if (file.size > MAX_BYTES) {
    return { error: 'File must be under 10 MB.' };
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

  revalidatePath(`/projects/${projectId}`);
  return { success: `Uploaded ${file.name}.` };
}

export async function deleteProjectFileAction(fileId: number, projectId: number) {
  await requireUser();
  const file = await getProjectFile(fileId);
  if (file && file.project_id === projectId) {
    await deleteProjectFile(fileId);
  }
  revalidatePath(`/projects/${projectId}`);
}
