'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  createQuote,
  updateQuote,
  updateQuoteStatus,
  deleteQuote,
  convertQuoteToProject,
  createQuoteWithItems,
  updateQuoteWithItems,
} from '@/lib/data';
import type { QuoteDocInput } from '@/lib/types';

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function createQuoteAction(formData: FormData) {
  await requireUser();
  const customer = String(formData.get('customer') ?? '').trim();
  const bid = parseFloat(String(formData.get('bid_value') ?? '0').replace(/[$,]/g, ''));
  if (!customer || isNaN(bid)) return;
  await createQuote({
    quote_number: String(formData.get('quote_number') ?? '').trim() || null,
    customer,
    project_name: String(formData.get('project_name') ?? '').trim() || null,
    category: String(formData.get('category') ?? '').trim() || null,
    bid_value: bid,
    date_received: String(formData.get('date_received') ?? '') || null,
    source: 'manual',
  });
  revalidatePath('/quotes');
  revalidatePath('/dashboard');
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

/** Create a full quote document (header + line items) and go to its printable page. */
export async function createQuoteDocAction(input: QuoteDocInput) {
  await requireUser();
  if (!input.customer?.trim()) return { error: 'Customer is required.' };
  const id = await createQuoteWithItems(sanitizeDoc(input));
  revalidatePath('/quotes');
  revalidatePath('/dashboard');
  redirect(`/quotes/${id}/print`);
}

/** Update an existing quote document, then return to its printable page. */
export async function updateQuoteDocAction(id: number, input: QuoteDocInput) {
  await requireUser();
  if (!input.customer?.trim()) return { error: 'Customer is required.' };
  await updateQuoteWithItems(id, sanitizeDoc(input));
  revalidatePath('/quotes');
  revalidatePath('/dashboard');
  revalidatePath(`/quotes/${id}/print`);
  redirect(`/quotes/${id}/print`);
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
    terms: clean(input.terms),
    notes: clean(input.notes),
    prepared_by: clean(input.prepared_by),
    items: (input.items ?? [])
      .filter((it) => (it.description ?? '').trim() !== '')
      .map((it) => ({
        description: it.description.trim(),
        quantity: Number.isFinite(it.quantity) ? it.quantity : 0,
        unit: clean(it.unit),
        unit_price: Number.isFinite(it.unit_price) ? it.unit_price : 0,
      })),
  };
}

export interface ParsedQuote {
  customer: string;
  project_name: string | null;
  category: string | null;
  bid_value: number;
}

/** Bulk-insert quotes parsed from an uploaded spreadsheet. */
export async function importQuotesAction(rows: ParsedQuote[]) {
  await requireUser();
  const weekOf = new Date().toISOString().slice(0, 10);
  let imported = 0;
  for (const r of rows) {
    if (!r.customer) continue;
    await createQuote({
      customer: r.customer,
      project_name: r.project_name,
      category: r.category,
      bid_value: r.bid_value || 0,
      date_received: weekOf,
      week_of: weekOf,
      source: 'import',
    });
    imported++;
  }
  revalidatePath('/quotes');
  revalidatePath('/dashboard');
  return { imported };
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
  revalidatePath('/quotes');
  revalidatePath('/projects');
  revalidatePath('/dashboard');
  if (projectId) redirect(`/projects/${projectId}`);
}
