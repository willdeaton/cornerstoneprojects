import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';

const COLUMN_HINTS: Record<string, string[]> = {
  quote_number: ['quote number', 'quote #', 'quote no', 'proposal number', 'proposal #', 'proposal no', 'quote id', 'quote ref'],
  date_received: ['date received', 'received', 'date', 'submitted', 'week of', 'quoted'],
  // Per-line-item columns. Detected before the header fields that would
  // otherwise steal them (e.g. "Description" → item, "Amount" → line total).
  item_type: ['item type', 'line type', 'row type', 'item kind', 'kind'],
  item_description: ['item description', 'item desc', 'line item', 'line description', 'description', 'item', 'scope item', 'work item'],
  quantity: ['quantity', 'qty'],
  unit_price: ['unit price', 'unit cost', 'price each', 'cost each', 'price/unit', 'rate', 'unit_price'],
  unit: ['unit', 'uom', 'u/m', 'measure'],
  amount: ['line total', 'line amount', 'ext amount', 'ext price', 'extended', 'item total', 'item amount', 'amount', 'price'],
  // Quote-header fields.
  customer: ['customer', 'client', 'account', 'company', 'name of customer'],
  category: ['category', 'trade', 'division', 'service', 'type'],
  tax_rate: ['tax rate', 'tax %', 'sales tax', 'tax'],
  markup_rate: ['markup rate', 'markup %', 'markup'],
  bid_value: ['bid value', 'quote value', 'contract value', 'total value', 'bid', 'contract', 'estimate', 'value', 'total'],
  project_name: ['project', 'scope of work', 'scope', 'job', 'work order', 'proposal'],
  notes: ['notes', 'note', 'comment', 'remarks', 'detail'],
};

// Fields checked first so a generic hint doesn't get claimed by a broader
// field before its specific column is matched. Line-item columns are resolved
// before the header fields whose hints overlap them.
const DETECT_ORDER = [
  'quote_number',
  'date_received',
  'item_type',
  'item_description',
  'quantity',
  'unit_price',
  'unit',
  'amount',
  'customer',
  'category',
  'tax_rate',
  'markup_rate',
  'bid_value',
  'project_name',
  'notes',
];

type Field = keyof typeof COLUMN_HINTS;

function detect(headers: string[]): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const f of DETECT_ORDER) map[f] = null;
  const lc = headers.map((h) => h.toLowerCase().trim());
  const taken = new Set<number>();
  for (const field of DETECT_ORDER) {
    for (const hint of COLUMN_HINTS[field as Field]) {
      const idx = lc.findIndex((h, i) => !taken.has(i) && h.includes(hint));
      if (idx !== -1) {
        map[field] = headers[idx];
        taken.add(idx);
        break;
      }
    }
  }
  return map;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Parse a rate cell into a fraction. "8.25" or "8.25%" → 0.0825; a bare
 * fraction like "0.0825" is kept as-is. Anything > 1 (or written with a %) is
 * treated as a percentage.
 */
function toRate(v: unknown): number {
  if (v == null || v === '') return 0;
  const s = String(v).trim();
  const hadPercent = s.includes('%');
  const n = parseFloat(s.replace(/[%,\s]/g, ''));
  if (isNaN(n)) return 0;
  if (hadPercent || n > 1) return n / 100;
  return n;
}

/** Coerce a cell into an ISO date string (YYYY-MM-DD), or null if unusable. */
function toDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  // xlsx returns real Date objects when cellDates is on.
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

interface ParsedLineItem {
  kind: 'pricing' | 'display';
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  amount: number | null;
}

interface ParsedQuote {
  quote_number: string | null;
  customer: string;
  project_name: string | null;
  category: string | null;
  bid_value: number;
  date_received: string | null;
  notes: string | null;
  tax_rate: number;
  markup_rate: number;
  items: ParsedLineItem[];
}

/** Total of a quote's customer-facing (display) lines, plus markup and tax. */
function displayTotal(q: ParsedQuote): number {
  const subtotal = q.items
    .filter((it) => it.kind === 'display')
    .reduce((s, it) => s + (it.amount != null ? it.amount : it.quantity * it.unit_price), 0);
  const markup = subtotal * (q.markup_rate || 0);
  const taxable = subtotal + markup;
  return taxable + taxable * (q.tax_rate || 0);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return NextResponse.json({ error: 'The file has no sheets.' }, { status: 400 });

    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    if (json.length === 0) {
      return NextResponse.json({ error: 'No rows found in the first sheet.' }, { status: 400 });
    }

    const headers = Object.keys(json[0]);
    const map = detect(headers);

    if (!map.customer) {
      return NextResponse.json(
        {
          error:
            'Could not find a Customer column. Use the template, or make sure your headers include a Customer column.',
          headers,
        },
        { status: 422 }
      );
    }

    // Line-item mode kicks in when the sheet carries any per-line column. Rows
    // are then grouped into quotes (many line items per quote). Otherwise each
    // row is one simple pipeline quote, as before.
    const hasLineItems = Boolean(
      map.item_description || map.quantity || map.unit_price || map.unit || map.amount || map.item_type
    );

    const cell = (r: Record<string, unknown>, col: string | null): string =>
      col ? String(r[col] ?? '').trim() : '';

    if (!hasLineItems) {
      const rows: ParsedQuote[] = json
        .map((r) => ({
          quote_number: cell(r, map.quote_number) || null,
          customer: cell(r, map.customer),
          project_name: cell(r, map.project_name) || null,
          category: cell(r, map.category) || null,
          bid_value: map.bid_value ? toNumber(r[map.bid_value]) : 0,
          date_received: map.date_received ? toDate(r[map.date_received]) : null,
          notes: cell(r, map.notes) || null,
          tax_rate: map.tax_rate ? toRate(r[map.tax_rate]) : 0,
          markup_rate: map.markup_rate ? toRate(r[map.markup_rate]) : 0,
          items: [],
        }))
        .filter((r) => r.customer || r.bid_value);
      return NextResponse.json({ rows, mapping: map, headers, count: rows.length, hasLineItems });
    }

    // ---- Line-item mode: fold rows into quotes ----
    const groups: ParsedQuote[] = [];
    const byKey = new Map<string, ParsedQuote>();
    let current: ParsedQuote | null = null;

    const keyFor = (quoteNo: string, customer: string, project: string): string | null => {
      if (quoteNo) return `q:${quoteNo.toLowerCase()}`;
      if (customer) return `c:${customer.toLowerCase()}|${project.toLowerCase()}`;
      return null;
    };

    for (const r of json) {
      const quoteNo = cell(r, map.quote_number);
      const customer = cell(r, map.customer);
      const project = cell(r, map.project_name);
      const hasHeader = Boolean(quoteNo || customer);
      const key = keyFor(quoteNo, customer, project);

      if (hasHeader) {
        const existing = key ? byKey.get(key) : undefined;
        if (existing) {
          current = existing;
          // Fill any header fields the group hasn't captured yet.
          if (!current.customer) current.customer = customer;
          if (!current.quote_number && quoteNo) current.quote_number = quoteNo;
          if (!current.project_name && project) current.project_name = project;
          if (!current.category && cell(r, map.category)) current.category = cell(r, map.category);
        } else {
          current = {
            quote_number: quoteNo || null,
            customer,
            project_name: project || null,
            category: cell(r, map.category) || null,
            bid_value: map.bid_value ? toNumber(r[map.bid_value]) : 0,
            date_received: map.date_received ? toDate(r[map.date_received]) : null,
            notes: cell(r, map.notes) || null,
            tax_rate: map.tax_rate ? toRate(r[map.tax_rate]) : 0,
            markup_rate: map.markup_rate ? toRate(r[map.markup_rate]) : 0,
            items: [],
          };
          groups.push(current);
          if (key) byKey.set(key, current);
        }
      }

      if (!current) continue; // orphan line item with no quote header — skip

      // Add a line item if this row carries any line-level content.
      const desc = cell(r, map.item_description);
      const unitPriceRaw = cell(r, map.unit_price);
      const amountRaw = cell(r, map.amount);
      const hasItem = Boolean(desc || unitPriceRaw || amountRaw);
      if (!hasItem) continue;

      const typeRaw = cell(r, map.item_type).toLowerCase();
      const kind: 'pricing' | 'display' =
        typeRaw.includes('pric') || typeRaw.includes('cost') || typeRaw.includes('internal') || typeRaw.includes('worksheet')
          ? 'pricing'
          : 'display';

      const qtyRaw = cell(r, map.quantity);
      const quantity = qtyRaw === '' ? 1 : toNumber(qtyRaw);
      const unit = cell(r, map.unit) || null;
      const unit_price = toNumber(unitPriceRaw);

      let amount: number | null;
      if (kind === 'pricing') {
        // Pricing worksheet rows compute qty × unit price in the app.
        amount = null;
      } else {
        amount = amountRaw !== '' ? toNumber(amountRaw) : quantity * unit_price;
      }

      current.items.push({
        kind,
        description: desc || (kind === 'pricing' ? 'Item' : project || 'Line item'),
        quantity,
        unit,
        unit_price,
        amount,
      });
    }

    // Fall back to a single display line from Bid Value when a quote only has
    // internal pricing rows, so its customer total isn't zero.
    for (const g of groups) {
      const hasDisplay = g.items.some((it) => it.kind === 'display');
      if (!hasDisplay && g.bid_value > 0) {
        g.items.push({
          kind: 'display',
          description: g.project_name || 'Project total',
          quantity: 1,
          unit: null,
          unit_price: 0,
          amount: g.bid_value,
        });
      }
      g.bid_value = g.items.length ? displayTotal(g) : g.bid_value;
    }

    const rows = groups.filter((g) => g.customer || g.bid_value);
    return NextResponse.json({ rows, mapping: map, headers, count: rows.length, hasLineItems });
  } catch (err) {
    console.error('parse error', err);
    return NextResponse.json(
      { error: 'Could not read that file. Make sure it is a valid .xlsx or .csv.' },
      { status: 400 }
    );
  }
}
