'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  updateQuote,
  updateQuoteStatus,
  deleteQuote,
  convertQuoteToProject,
  createQuoteWithItems,
  updateQuoteWithItems,
  getQuote,
} from '@/lib/data';
import type { QuoteDocInput } from '@/lib/types';
import { sendNewProjectEmail } from '@/lib/email/send';

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function updateQuoteAction(id: number, formData: FormData) {
  await requireUser();
  const bidRaw = String(formData.get('bid_value') ?? '').replace(/[$,]/g, '').trim();
  const bid = parseFloat(bidRaw);
  await updateQuote(id, {
    quote_number: String(formData.get('quote_number') ?? '').trim() || null,
    customer: String(formData.get('customer') ?? '').trim() || undefined,
    project_name: String(formData.get('project_name') ?? '').trim() || null,
    category: String(formData.get('category') ?? '').trim() || null,
    bid_value: bidRaw === '' || isNaN(bid) ? undefined : bid,
    date_received: String(formData.get('date_received') ?? '') || null,
  });
  revalidatePath('/quotes');
  revalidatePath('/dashboard');
}

/**
 * Create a full quote document (header + line items). When `viewPdf` is true
 * the user is taken to the printable page; otherwise they return to the quotes
 * list so the quote can be saved without downloading a PDF.
 */
export async function createQuoteDocAction(input: QuoteDocInput, viewPdf = true) {
  await requireUser();
  if (!input.customer?.trim()) return { error: 'Customer is required.' };
  if (!input.quote_number?.trim()) return { error: 'Quote # is required.' };
  if (!input.project_name?.trim()) return { error: 'Project / Description is required.' };
  const id = await createQuoteWithItems(sanitizeDoc(input));
  revalidatePath('/quotes');
  revalidatePath('/dashboard');
  redirect(viewPdf ? `/quotes/${id}/print` : '/quotes');
}

/**
 * Update an existing quote document. `after` controls where the user lands:
 * `'pdf'` opens the printable page, `'list'` returns to the quotes list, and
 * `'stay'` keeps them on the edit page (returning `{ ok: true }` instead of
 * redirecting) so a plain Save can persist without leaving the form.
 */
export async function updateQuoteDocAction(
  id: number,
  input: QuoteDocInput,
  after: 'pdf' | 'list' | 'stay' = 'pdf'
) {
  await requireUser();
  if (!input.customer?.trim()) return { error: 'Customer is required.' };
  if (!input.project_name?.trim()) return { error: 'Project / Description is required.' };
  await updateQuoteWithItems(id, sanitizeDoc(input));
  revalidatePath('/quotes');
  revalidatePath('/dashboard');
  revalidatePath(`/quotes/${id}/print`);
  if (after === 'stay') return { ok: true };
  redirect(after === 'pdf' ? `/quotes/${id}/print` : '/quotes');
}

/** Trim strings, coerce numbers, and drop blank line items before persisting. */
function sanitizeDoc(input: QuoteDocInput): QuoteDocInput {
  const clean = (v: string | null | undefined) => {
    const t = (v ?? '').toString().trim();
    return t === '' ? null : t;
  };
  return {
    quote_number: clean(input.quote_number),
    customer: input.customer.trim(),
    customer_contact: clean(input.customer_contact),
    customer_email: clean(input.customer_email),
    customer_phone: clean(input.customer_phone),
    customer_address: clean(input.customer_address),
    project_name: clean(input.project_name),
    project_location: clean(input.project_location),
    category: clean(input.category),
    issue_date: clean(input.issue_date),
    valid_until: clean(input.valid_until),
    tax_rate: Number.isFinite(input.tax_rate) ? Math.max(0, input.tax_rate) : 0,
    markup_rate: Number.isFinite(input.markup_rate) ? Math.max(0, input.markup_rate) : 0,
    terms: clean(input.terms),
    notes: clean(input.notes),
    prepared_by: clean(input.prepared_by),
    internal_notes: clean(input.internal_notes),
    items: (input.items ?? [])
      .filter((it) => (it.description ?? '').trim() !== '')
      .map((it) => ({
        kind: it.kind === 'pricing' ? ('pricing' as const) : ('display' as const),
        description: it.description.trim(),
        quantity: Number.isFinite(it.quantity) ? it.quantity : 0,
        unit: clean(it.unit),
        unit_price: Number.isFinite(it.unit_price) ? it.unit_price : 0,
        amount: it.amount != null && Number.isFinite(it.amount) ? it.amount : null,
        markup_rate: Number.isFinite(it.markup_rate) ? Math.max(0, it.markup_rate) : 0,
        cost_type: clean(it.cost_type),
      })),
  };
}

export async function markQuoteLostAction(id: number) {
  await requireUser();
  await updateQuoteStatus(id, 'lost');
  revalidatePath('/quotes');
  revalidatePath('/dashboard');
}

export async function reopenQuoteAction(id: number) {
  await requireUser();
  await updateQuoteStatus(id, 'open');
  revalidatePath('/quotes');
  revalidatePath('/dashboard');
}

export async function deleteQuoteAction(id: number) {
  await requireUser();
  await deleteQuote(id);
  revalidatePath('/quotes');
  revalidatePath('/dashboard');
}

/** Convert a quote into a sold project and jump to it. */
export async function convertQuoteAction(id: number) {
  await requireUser();
  const projectId = await convertQuoteToProject(id);
  // Best-effort new-project notification; must not block the conversion.
  if (projectId) await sendNewProjectEmail(projectId);
  revalidatePath('/quotes');
  revalidatePath('/projects');
  revalidatePath('/dashboard');
  if (projectId) redirect(`/projects/${projectId}`);
}

/* --------------------------------------------------------- Bulk quote actions */

/** Delete several quotes at once. */
export async function bulkDeleteQuotesAction(ids: number[]) {
  await requireUser();
  for (const id of ids) await deleteQuote(id);
  revalidatePath('/quotes');
  revalidatePath('/dashboard');
  return { count: ids.length };
}

/** Mark several open quotes as lost. Non-open quotes are skipped. */
export async function bulkMarkQuotesLostAction(ids: number[]) {
  await requireUser();
  let count = 0;
  for (const id of ids) {
    const quote = await getQuote(id);
    if (quote && quote.status === 'open') {
      await updateQuoteStatus(id, 'lost');
      count++;
    }
  }
  revalidatePath('/quotes');
  revalidatePath('/dashboard');
  return { count };
}

/**
 * Mark several open quotes as sold, converting each into a project. Quotes that
 * aren't currently open are skipped so we never create a duplicate project.
 */
export async function bulkMarkQuotesSoldAction(ids: number[]) {
  await requireUser();
  let count = 0;
  for (const id of ids) {
    const quote = await getQuote(id);
    if (quote && quote.status === 'open') {
      const projectId = await convertQuoteToProject(id);
      // Best-effort new-project notification per converted quote.
      if (projectId) await sendNewProjectEmail(projectId);
      count++;
    }
  }
  revalidatePath('/quotes');
  revalidatePath('/projects');
  revalidatePath('/dashboard');
  return { count };
}
