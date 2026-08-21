'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  setProjectBillingHold,
  setProjectBillingClosed,
  setInvoiceFile,
  deleteInvoiceFile,
  invoiceBelongsToProject,
} from '@/lib/data';

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

/* ------------------------------------------------------ The invoice PDF */

/** Same ceiling as project files — a scanned invoice has no business being
 *  bigger, and the limit is what keeps the inline blobs sane. */
const MAX_PDF_BYTES = 10_000_000; // 10 MB

/**
 * Attach the PDF that was sent to the customer to one invoice, replacing
 * whatever was there. One invoice has one invoice document, so re-uploading is
 * how a wrong file gets corrected rather than something to clean up first.
 *
 * The invoice is checked against the project the caller named, so an id from
 * somebody else's job can't be written to even by a biller.
 */
export async function uploadInvoicePdfAction(
  projectId: number,
  invoiceId: number,
  formData: FormData
): Promise<{ error?: string; filename?: string }> {
  const user = await requireBiller();
  if (!(await invoiceBelongsToProject(invoiceId, projectId))) {
    return { error: 'That invoice is not on this job.' };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a file to attach.' };
  if (file.size > MAX_PDF_BYTES) return { error: 'The invoice file must be under 10 MB.' };

  const mime = file.type || 'application/octet-stream';
  const buf = Buffer.from(await file.arrayBuffer());
  await setInvoiceFile({
    invoice_id: invoiceId,
    filename: file.name || 'invoice.pdf',
    mime,
    size: file.size,
    data: `data:${mime};base64,${buf.toString('base64')}`,
    uploaded_by: user.id,
    uploader_name: user.name,
  });

  revalidateBilling(projectId);
  return { filename: file.name || 'invoice.pdf' };
}

/** Detach an invoice's PDF. The invoice row itself is left alone. */
export async function removeInvoicePdfAction(
  projectId: number,
  invoiceId: number
): Promise<{ error?: string }> {
  await requireBiller();
  if (!(await invoiceBelongsToProject(invoiceId, projectId))) {
    return { error: 'That invoice is not on this job.' };
  }
  await deleteInvoiceFile(invoiceId);
  revalidateBilling(projectId);
  return {};
}
