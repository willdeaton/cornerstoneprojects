'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  setProjectBillingHold,
  setProjectBillingClosed,
  markProjectBilling,
  listProjectInvoices,
  setInvoiceFile,
  deleteInvoiceFile,
  invoiceBelongsToProject,
  getProject,
  recordProjectValueChange,
  listProjectValueChanges,
} from '@/lib/data';
import {
  billingSummary,
  tallyInvoices,
  originalContractValue,
  CONTRACT_LOCK_REASON,
  type BillingSummary,
} from '@/lib/billing';
import { money } from '@/lib/format';
import type { ProjectInvoiceWithFile, ProjectValueChange } from '@/lib/types';

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
  // The dashboard counts invoiced work too, so a mark made here shows up there.
  revalidatePath('/dashboard');
}

/**
 * One job's invoice ledger, for the billing desk to open a job's billing
 * without leaving the page.
 *
 * The desk loads these a job at a time, on the row being expanded, rather than
 * every invoice on every completed job up front — the page stays the size of
 * the queue however many years of paperwork are behind it.
 */
export async function listJobInvoicesAction(
  projectId: number
): Promise<ProjectInvoiceWithFile[]> {
  await requireBiller();
  return listProjectInvoices(projectId);
}

/**
 * Mark a job billed, or billed and paid, without entering any invoice detail.
 *
 * Plenty of work is invoiced and collected outside this app, and making
 * somebody type an invoice number, a PO and a send date just to get a finished
 * job off the desk is how a billing queue stops being trusted. So this marks
 * every invoice on the job sent (and paid, when asked), and raises one for the
 * contract value when the job has nothing on it at all.
 *
 * It is deliberately not a separate "billed anyway" flag: what it writes is an
 * ordinary invoice row, which is why the stage, the aging and every total
 * follow from it with no special case anywhere — and why it is undone by
 * editing the row in the ledger like any other.
 */
export async function markBillingAction(
  projectId: number,
  mark: 'billed' | 'paid'
): Promise<{ error?: string }> {
  await requireBiller();
  const touched = await markProjectBilling(projectId, mark === 'paid');
  if (touched === 0) return { error: 'That job no longer exists.' };
  revalidateBilling(projectId);
  return {};
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

/* ------------------------------------------- Contract value & change orders */

/** Everything the change-order dialog needs, as of the moment it opens. */
export interface ContractValueContext {
  current: number;
  /** Derived from the earliest change; equals `current` on an unchanged job. */
  soldAt: number;
  summary: BillingSummary;
  changes: ProjectValueChange[];
}

/**
 * Loaded when the dialog opens rather than passed down from the job header.
 *
 * The header is on every tab and has no business paying for a job's invoice
 * rows, and the figures the dialog reasons about — what has been invoiced, what
 * is left to bill — have to be the ones true now, not the ones true when the
 * page was rendered. Same shape as the billing desk opening a job's ledger.
 */
export async function getContractValueContextAction(
  projectId: number
): Promise<ContractValueContext | null> {
  await requireBiller();
  const [project, invoices, changes] = await Promise.all([
    getProject(projectId),
    listProjectInvoices(projectId),
    listProjectValueChanges(projectId),
  ]);
  if (!project) return null;
  return {
    current: project.value,
    soldAt: originalContractValue(project.value, changes),
    summary: billingSummary(project, tallyInvoices(invoices)),
    changes,
  };
}

/**
 * Record a change to a sold job's contract value.
 *
 * Admins and managers only — the same line the Billing tab and the invoice
 * ledger draw, and a tightening: this used to be a bare text input on the Edit
 * Project form that any non-employee could retype, with nothing recording that
 * they had.
 *
 * Every check that matters is here rather than in the dialog. The dialog hides
 * the form on a locked job and disables Save on an empty reason, but that is
 * courtesy — a stale tab, or a direct call, has to meet the same rules.
 */
export async function changeContractValueAction(
  projectId: number,
  input: { value: string; co_number: string; reason: string }
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireBiller();

  // Arrives as typed ("$27,500.00"), the same way invoice amounts do.
  const parsed = parseFloat(String(input.value ?? '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(parsed)) return { ok: false, error: 'Enter the new contract value.' };
  if (parsed < 0) {
    return {
      ok: false,
      error: "A contract value can't be negative — use 0 for work that is no longer billable.",
    };
  }
  // Money is dollars and cents and the column is a float: round once, here, so
  // the stored value, the history row and every variance agree on the figure.
  const value = Math.round(parsed * 100) / 100;

  const reason = String(input.reason ?? '').trim();
  if (!reason) return { ok: false, error: 'Say why the contract value is changing.' };

  const res = await recordProjectValueChange({
    project_id: projectId,
    new_value: value,
    co_number: String(input.co_number ?? '').trim() || null,
    reason,
    changed_by: user.id,
  });
  if (res.status === 'missing') return { ok: false, error: 'That job no longer exists.' };
  if (res.status === 'locked') return { ok: false, error: CONTRACT_LOCK_REASON[res.stage] };
  if (res.status === 'noop') {
    return { ok: false, error: `This job is already worth ${money(res.value)} — nothing changed.` };
  }

  revalidateBilling(projectId);
  return { ok: true };
}
