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
} from '@/lib/data';

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
