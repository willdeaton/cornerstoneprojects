'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { setSetting } from '@/lib/data';

async function requireManager() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin' && user.role !== 'manager') {
    throw new Error('Not authorized.');
  }
  return user;
}

export interface LogoState {
  error?: string;
  success?: string;
}

const MAX_BYTES = 1_000_000; // 1 MB
const ALLOWED = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif'];

export async function uploadLogoAction(_prev: LogoState, formData: FormData): Promise<LogoState> {
  await requireManager();
  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose an image file to upload.' };
  }
  if (!ALLOWED.includes(file.type)) {
    return { error: 'Use a PNG, JPG, SVG, WEBP or GIF image.' };
  }
  if (file.size > MAX_BYTES) {
    return { error: 'Image must be under 1 MB.' };
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type};base64,${buf.toString('base64')}`;
  setSetting('logo', dataUrl);
  revalidatePath('/', 'layout');
  revalidatePath('/settings');
  revalidatePath('/login');
  return { success: 'Logo updated.' };
}

export async function resetLogoAction() {
  await requireManager();
  setSetting('logo', null);
  revalidatePath('/', 'layout');
  revalidatePath('/settings');
  revalidatePath('/login');
}
