'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  updateQuoteStatus,
  deleteQuote,
  convertQuoteToProject,
  createQuoteWithItems,
  updateQuoteWithItems,
  getQuote,
  nextAvailableQuoteNumber,
} from '@/lib/data';
import type { QuoteDocInput } from '@/lib/types';
import { quoteNumberBase } from '@/lib/quote-number';
import { safeListHref } from '@/lib/list-state';
import { sendNewProjectEmail } from '@/lib/email/send';

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Employees are time-clock-only — they may never touch quotes.
  if (user.role === 'employee') throw new Error('Not authorized.');
  return user;
}

/**
 * The quote number to use for a customer code and issue date — `XXXMMDDYY`,
 * with `-2`, `-3`, … appended if that number is already taken (a second quote
 * for the same customer on the same day). Returns `null` when the customer has
 * no abbreviation or the date is missing, in which case the builder leaves the
 * field for the user to fill in.
 *
 * `quoteId` is the quote being edited, so its own number isn't counted as taken.
 */
export async function suggestQuoteNumberAction(
  abbreviation: string | null,
  issueDate: string | null,
  quoteId?: number
): Promise<{ number: string | null }> {
  await requireUser();
  const base = quoteNumberBase(abbreviation, issueDate);
  if (!base) return { number: null };
  return { number: await nextAvailableQuoteNumber(base, quoteId) };
}

/**
 * Create a quote document. `after` controls where the user lands: `'pdf'`
 * opens the printable page, `'list'` returns to the quotes list, and `'stay'`
 * returns `{ ok: true, id, … }` instead of redirecting so the builder can move
 * to the new quote's edit page without leaving the form.
 *
 * `returnTo` is the list URL the builder was opened from, so `'list'` comes
 * back to that tab rather than the default one. Ignored unless it is a plain
 * `/quotes` path.
 *
 * A `'stay'` return also carries `saved` — how many line items actually reached
 * the database — so the builder can tell a clean save from one that quietly
 * stored less than the screen shows.
 */
export async function createQuoteDocAction(
  input: QuoteDocInput,
  after: 'pdf' | 'list' | 'stay' = 'pdf',
  returnTo?: string
) {
  await requireUser();
  if (!input.customer?.trim()) return { error: 'Customer is required.' };
  if (!input.quote_number?.trim()) return { error: 'Quote # is required.' };
  if (!input.project_name?.trim()) return { error: 'Project / Description is required.' };
  const doc = sanitizeDoc(input);
  const { id, saved } = await createQuoteWithItems(doc);
  revalidatePath('/quotes');
  revalidatePath('/dashboard');
  if (after === 'stay') return { ok: true, id, saved, sent: doc.items.length };
  redirect(after === 'pdf' ? `/quotes/${id}/print` : safeListHref(returnTo, '/quotes'));
}

/**
 * Update an existing quote document. `after` controls where the user lands:
 * `'pdf'` opens the printable page, `'list'` returns to the quotes list (see
 * `returnTo` above), and `'stay'` keeps them on the edit page (returning
 * `{ ok: true, saved, sent }` instead of redirecting) so a plain Save can
 * persist without leaving the form — and so the builder can check that every
 * line it sent was actually stored.
 */
export async function updateQuoteDocAction(
  id: number,
  input: QuoteDocInput,
  after: 'pdf' | 'list' | 'stay' = 'pdf',
  returnTo?: string
) {
  await requireUser();
  if (!input.customer?.trim()) return { error: 'Customer is required.' };
  if (!input.project_name?.trim()) return { error: 'Project / Description is required.' };
  const doc = sanitizeDoc(input);
  const { saved } = await updateQuoteWithItems(id, doc);
  revalidatePath('/quotes');
  revalidatePath('/dashboard');
  revalidatePath(`/quotes/${id}/print`);
  if (after === 'stay') return { ok: true, saved, sent: doc.items.length };
  redirect(after === 'pdf' ? `/quotes/${id}/print` : safeListHref(returnTo, '/quotes'));
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
      // Blank rows are dropped — except a priced option line, which is still
      // worth keeping even if its description was left empty.
      .filter(
        (it) =>
          (it.description ?? '').trim() !== '' ||
          (it.kind === 'alternate' && it.amount != null && Number.isFinite(it.amount))
      )
      .map((it) => {
        const kind =
          it.kind === 'pricing'
            ? ('pricing' as const)
            : it.kind === 'alternate'
              ? ('alternate' as const)
              : ('display' as const);
        return {
          kind,
          description: (it.description ?? '').trim(),
          quantity: Number.isFinite(it.quantity) ? it.quantity : 0,
          unit: clean(it.unit),
          unit_price: Number.isFinite(it.unit_price) ? it.unit_price : 0,
          amount: it.amount != null && Number.isFinite(it.amount) ? it.amount : null,
          markup_rate: Number.isFinite(it.markup_rate) ? Math.max(0, it.markup_rate) : 0,
          cost_type: clean(it.cost_type),
          // A group name only means something on an option line; `clean` maps ''
          // to null so a blank name can't become a distinct grouping key.
          option_group: kind === 'alternate' ? clean(it.option_group) : null,
        };
      }),
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
