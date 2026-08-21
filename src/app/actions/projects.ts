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
  listProjectInvoices,
  addProjectInvoice,
  updateProjectInvoice,
  setProjectInvoicePosition,
  deleteProjectInvoice,
} from '@/lib/data';
import { sendJobCompletedEmail } from '@/lib/email/send';

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Employees are time-clock-only — they may never touch projects.
  if (user.role === 'employee') throw new Error('Not authorized.');
  return user;
}

/**
 * Billing is an admin/manager concern — what a customer owes is not an
 * employee's view, which is the line the Billing page, the nav and the project
 * list all already draw. Invoices are the numbers behind it, so they draw it too.
 */
async function requireBiller() {
  const user = await requireUser();
  if (user.role !== 'admin' && user.role !== 'manager') {
    throw new Error('Not authorized.');
  }
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
    site_address: String(formData.get('site_address') ?? '').trim() || null,
    start_date: String(formData.get('start_date') ?? '') || null,
    end_date: String(formData.get('end_date') ?? '') || null,
    due_date: String(formData.get('due_date') ?? '') || null,
    hard_finish_date: String(formData.get('hard_finish_date') ?? '') || null,
  });
  revalidatePath('/projects');
  revalidatePath('/dashboard');
  redirect(`/projects/${id}`);
}

export async function setProjectStatusAction(id: number, status: ProjectStatus) {
  await requireUser();
  const progress = status === 'completed' ? 100 : status === 'not_started' ? 0 : undefined;
  await updateProject(id, progress != null ? { status, progress } : { status });
  // Best-effort completion notification when a job is marked complete; must not
  // block the status update.
  if (status === 'completed') await sendJobCompletedEmail(id);
  revalidatePath(`/projects/${id}`, 'layout');
  revalidatePath('/projects');
  revalidatePath('/dashboard');
}

export async function setProjectProgressAction(id: number, progress: number) {
  await requireUser();
  await updateProject(id, { progress: Math.max(0, Math.min(100, progress)) });
  revalidatePath(`/projects/${id}`, 'layout');
  revalidatePath('/projects');
}

/**
 * Save the Edit Project form. `site_address` is the address the crew drives to —
 * `location` stays the short label the lists and quotes use — and
 * `hard_finish_date` is the date the job must be done by, as opposed to the
 * due-date target. Moving a hard finish date from the schedule asks for a reason
 * (see setHardFinishDateAction); editing the job's own details is where it's set
 * up in the first place.
 */
export async function updateProjectDetailsAction(id: number, formData: FormData) {
  await requireUser();
  const value = parseFloat(String(formData.get('value') ?? '0').replace(/[$,]/g, ''));
  await updateProject(id, {
    name: String(formData.get('name') ?? '').trim() || undefined,
    quote_number: String(formData.get('quote_number') ?? '').trim() || null,
    category: String(formData.get('category') ?? '').trim() || null,
    value: isNaN(value) ? undefined : value,
    location: String(formData.get('location') ?? '').trim() || null,
    site_address: String(formData.get('site_address') ?? '').trim() || null,
    start_date: String(formData.get('start_date') ?? '') || null,
    end_date: String(formData.get('end_date') ?? '') || null,
    due_date: String(formData.get('due_date') ?? '') || null,
    hard_finish_date: String(formData.get('hard_finish_date') ?? '') || null,
  });
  revalidatePath(`/projects/${id}`, 'layout');
  revalidatePath('/projects');
  revalidatePath('/dashboard');
}

/** One invoice row as submitted from the project's Invoicing card. */
export interface InvoiceInput {
  /** Existing invoice id, or null for a row added in this edit. */
  id: number | null;
  invoice_number: string;
  /** Free text as typed ("$1,200.50") — parsed server-side. */
  amount: string;
  billed: boolean;
  paid: boolean;
}

/**
 * Save the whole Invoicing card in one go: the invoice list plus the notes.
 * Rows missing from `invoices` are deleted, rows with an id are updated, and
 * rows without one are inserted — so the client can add, edit and remove
 * locally and commit it all with a single Save.
 */
export async function updateInvoiceAction(
  id: number,
  invoices: InvoiceInput[],
  formData: FormData
) {
  await requireBiller();

  await updateProject(id, {
    invoice_notes: String(formData.get('invoice_notes') ?? '').trim() || null,
  });

  const existing = await listProjectInvoices(id);
  const keep = new Set(invoices.map((inv) => inv.id).filter((v): v is number => v != null));
  for (const row of existing) {
    if (!keep.has(row.id)) await deleteProjectInvoice(row.id);
  }

  for (const [i, inv] of invoices.entries()) {
    // Amounts arrive as typed, so strip currency formatting before parsing.
    const parsed = parseFloat(String(inv.amount ?? '').replace(/[$,\s]/g, ''));
    const amount = isNaN(parsed) ? 0 : parsed;
    // Paid implies billed — an invoice can't be collected on before it goes out.
    const billed = inv.paid || inv.billed;
    const fields = {
      invoice_number: inv.invoice_number.trim() || null,
      amount,
      billed,
      paid: inv.paid,
    };
    // Only touch rows that belong to this project; ignore anything else.
    if (inv.id != null && existing.some((row) => row.id === inv.id)) {
      await updateProjectInvoice(inv.id, fields);
      await setProjectInvoicePosition(inv.id, i + 1);
    } else {
      await addProjectInvoice({ project_id: id, ...fields });
    }
  }

  revalidatePath(`/projects/${id}`, 'layout');
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
  revalidatePath(`/projects/${projectId}`, 'layout');
}

export async function deleteNoteAction(projectId: number, noteId: number) {
  await requireUser();
  await deleteNote(noteId);
  revalidatePath(`/projects/${projectId}`, 'layout');
}
