'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { setLogo, type LogoKind } from '@/lib/branding-store';

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') {
    throw new Error('You do not have permission to change branding.');
  }
  return user;
}

export interface LogoUploadState {
  error?: string;
  success?: string;
}

const MAX_BYTES = 3_000_000; // 3 MB
const KINDS: LogoKind[] = ['full', 'icon', 'estimate'];

function parseKind(v: FormDataEntryValue | null): LogoKind | null {
  return typeof v === 'string' && (KINDS as string[]).includes(v) ? (v as LogoKind) : null;
}

/** Refresh everywhere a logo appears: sidebar (all pages), quote PDFs, settings. */
function revalidateBranding() {
  revalidatePath('/', 'layout');
}

export async function uploadLogoAction(
  _prev: LogoUploadState,
  formData: FormData
): Promise<LogoUploadState> {
  await requireAdmin();

  const kind = parseKind(formData.get('kind'));
  if (!kind) return { error: 'Unknown logo type.' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose an image to upload.' };
  }
  if (!file.type.startsWith('image/')) {
    return { error: 'That file is not an image (PNG, JPG, or SVG).' };
  }
  if (file.size > MAX_BYTES) {
    return { error: 'Image must be under 3 MB.' };
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || 'image/png';
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;

  await setLogo(kind, dataUrl);
  revalidateBranding();
  return { success: 'Logo updated.' };
}

/** Clear an uploaded logo so it reverts to its default/fallback. */
export async function resetLogoAction(kind: LogoKind): Promise<void> {
  await requireAdmin();
  await setLogo(kind, null);
  revalidateBranding();
}
