/**
 * Commit endpoint for the temporary Bulk Upload tool. Creates or updates one
 * quote and attaches its files. Implemented as a route handler (not a server
 * action) so multi-megabyte PDF/Excel uploads aren't capped by the ~1 MB
 * server-action body limit. Delete this folder to remove the tool.
 */
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth';
import {
  createQuoteWithItems,
  updateQuoteWithItems,
  updateQuote,
  getQuote,
  addQuoteFile,
} from '@/lib/data';
import type { QuoteDocInput, LineItemInput, QuoteItemKind } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 10_000_000; // 10 MB, matching the standard file-upload cap.

interface CommitPayload {
  mode: 'create' | 'update';
  quoteId?: number;
  /** Explicit bid value from the PDF, used only when there are no display lines. */
  bidValue?: number | null;
  doc: QuoteDocInput;
}

function coerceItems(items: unknown): LineItemInput[] {
  if (!Array.isArray(items)) return [];
  return items.map((raw) => {
    const it = (raw ?? {}) as Record<string, unknown>;
    const kind: QuoteItemKind =
      it.kind === 'pricing' ? 'pricing' : it.kind === 'alternate' ? 'alternate' : 'display';
    const numOr = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
    return {
      kind,
      description: String(it.description ?? '').trim(),
      quantity: numOr(it.quantity, 0),
      unit: it.unit ? String(it.unit).trim() : null,
      unit_price: numOr(it.unit_price, 0),
      amount: it.amount == null || it.amount === '' ? null : numOr(it.amount, 0),
      markup_rate: numOr(it.markup_rate, 0),
      cost_type: it.cost_type ? String(it.cost_type).trim() : null,
      // Imported options are single-line and ungrouped; the quote builder names
      // and groups them the first time the quote is edited there.
      option_group: null,
    };
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (user.role !== 'admin') return new Response('Forbidden', { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Expected multipart form data.' }, { status: 400 });
  }

  const raw = form.get('payload');
  if (typeof raw !== 'string') return Response.json({ error: 'Missing payload.' }, { status: 400 });

  let payload: CommitPayload;
  try {
    payload = JSON.parse(raw) as CommitPayload;
  } catch {
    return Response.json({ error: 'Invalid payload JSON.' }, { status: 400 });
  }

  const d = payload.doc ?? ({} as QuoteDocInput);
  if (!d.customer?.trim()) return Response.json({ error: 'Customer is required.' }, { status: 400 });

  const doc: QuoteDocInput = {
    quote_number: d.quote_number?.trim() || null,
    customer: d.customer.trim(),
    customer_contact: d.customer_contact?.trim() || null,
    customer_email: d.customer_email?.trim() || null,
    customer_phone: d.customer_phone?.trim() || null,
    customer_address: d.customer_address?.trim() || null,
    project_name: d.project_name?.trim() || null,
    project_location: d.project_location?.trim() || null,
    category: d.category?.trim() || null,
    issue_date: d.issue_date?.trim() || null,
    valid_until: d.valid_until?.trim() || null,
    tax_rate: 0,
    markup_rate: 0,
    terms: d.terms?.trim() || null,
    notes: d.notes?.trim() || null,
    prepared_by: d.prepared_by?.trim() || null,
    internal_notes: d.internal_notes?.trim() || null,
    items: coerceItems(d.items),
  };

  // Create or update the quote.
  let quoteId: number;
  try {
    if (payload.mode === 'update') {
      const id = Number(payload.quoteId);
      if (!id || !(await getQuote(id))) {
        return Response.json({ error: 'Quote to update was not found.' }, { status: 400 });
      }
      await updateQuoteWithItems(id, doc);
      quoteId = id;
    } else {
      quoteId = await createQuoteWithItems(doc, { source: 'bulk-import' });
    }

    // The bid value is derived from display line items. When the import has no
    // display lines (e.g. only internal pricing rows), fall back to the value
    // read off the PDF so the quote still shows a total.
    const hasDisplay = doc.items.some((it) => it.kind === 'display' && it.description);
    if (!hasDisplay && payload.bidValue != null && Number.isFinite(payload.bidValue)) {
      await updateQuote(quoteId, { bid_value: Math.max(0, Number(payload.bidValue)) });
    }
  } catch (err) {
    console.error('bulk-upload commit failed', err);
    return Response.json({ error: 'Failed to save the quote.' }, { status: 500 });
  }

  // Attach every uploaded file to the quote (base64 data URL, same as the
  // standard quote-file uploader).
  const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  const attached: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      skipped.push(file.name || 'file');
      continue;
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || 'application/octet-stream';
    await addQuoteFile({
      quote_id: quoteId,
      filename: file.name || 'upload',
      mime,
      size: file.size,
      data: `data:${mime};base64,${buf.toString('base64')}`,
      uploaded_by: user.id,
      uploader_name: user.name,
    });
    attached.push(file.name || 'file');
  }

  revalidatePath('/quotes');
  revalidatePath('/dashboard');
  revalidatePath(`/quotes/${quoteId}/edit`);

  return Response.json({ ok: true, quoteId, attached, skipped });
}
