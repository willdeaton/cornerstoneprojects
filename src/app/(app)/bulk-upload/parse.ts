/**
 * Pure parsing helpers for the temporary Bulk Upload tool.
 *
 * These functions are deliberately framework-agnostic (no React, no browser or
 * server APIs): the client component does the file reading + `unpdf`/`xlsx`
 * calls, then hands the raw text / rows here for interpretation. Keeping the
 * heuristics in one small file makes them easy to tune against a real sample —
 * and easy to delete when the tool is removed.
 */

import type { QuoteItemKind } from '@/lib/types';

/** One editable line-item row in the Bulk Upload card (all values as strings). */
export interface DraftLine {
  kind: QuoteItemKind;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  amount: string;
  cost_type: string;
}

/** Header fields the parsers try to pre-fill. All optional / best-effort. */
export interface DraftHeader {
  quote_number: string;
  customer: string;
  project_name: string;
  category: string;
  bid_value: string;
  issue_date: string;
  valid_until: string;
}

/* ----------------------------------------------------------------- numbers */

/** Parse a currency-ish string ("$1,234.50") to a number, or null if blank. */
export function parseNumber(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[$,\s]/g, '').replace(/[()]/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------- dates */

/** Best-effort convert a loose date string to ISO `YYYY-MM-DD`, else ''. */
export function toIsoDate(v: unknown): string {
  if (v == null) return '';
  const raw = String(v).trim();
  if (raw === '') return '';
  // Already ISO.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // M/D/Y or M-D-Y (US ordering, which is what these quotes use).
  const us = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (us) {
    let [, mo, da, yr] = us;
    if (yr.length === 2) yr = Number(yr) > 50 ? `19${yr}` : `20${yr}`;
    return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
  }
  // Fall back to Date parsing (e.g. "January 5, 2026").
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  }
  return '';
}

/* ----------------------------------------------------- PDF text → header */

// Words that mark the end of a captured value — used to trim over-long grabs
// when the extracted PDF text has no line breaks between fields.
const STOP_WORDS = [
  'subtotal', 'sub-total', 'total', 'date', 'valid until', 'valid through',
  'expires', 'expiration', 'phone', 'fax', 'email', 'e-mail', 'terms',
  'quantity', 'qty', 'unit price', 'amount', 'bill to', 'sold to', 'prepared',
];

/** Trim a captured value at the next label/stop word, drop trailing separators. */
function cleanValue(raw: string, extraStops: string[] = []): string {
  let v = raw.trim();
  const stops = [...STOP_WORDS, ...extraStops];
  let cut = v.length;
  const lower = v.toLowerCase();
  for (const w of stops) {
    const idx = lower.indexOf(w);
    if (idx > 0 && idx < cut) cut = idx;
  }
  v = v.slice(0, cut).replace(/[\s:;,\-|]+$/, '').trim();
  return v.length > 80 ? v.slice(0, 80).trim() : v;
}

/** Grab the text right after a label on the same or next line, then clean it. */
function afterLabel(text: string, labels: string[], extraStops: string[] = []): string {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:#-]?\\s*(.+?)(?:\\n|$)`, 'i');
    const m = text.match(re);
    if (m && m[1].trim()) {
      const v = cleanValue(m[1], extraStops);
      if (v) return v;
    }
  }
  return '';
}

/**
 * Best-effort extraction of quote-header fields from raw PDF text. Everything
 * here is a heuristic and every field is editable in the UI afterwards — the
 * goal is to save typing, not to be perfect. Scanned/image PDFs yield no text,
 * in which case this returns mostly-empty values and the caller flags it.
 */
export function extractHeaderFromPdfText(text: string): DraftHeader {
  const header: DraftHeader = {
    quote_number: '',
    customer: '',
    project_name: '',
    category: '',
    bid_value: '',
    issue_date: '',
    valid_until: '',
  };
  if (!text) return header;

  // Quote / proposal / estimate number. Capture a token that contains a digit
  // (so multi-dash ids like "Q-PW-777" and simple ones like "Q-2601" both work).
  const qn =
    text.match(/(?:quote|proposal|estimate|bid)\s*(?:#|no\.?|number)?\s*[:#-]?\s*([A-Za-z0-9][\w-]*\d[\w-]*)/i) ||
    text.match(/\b([A-Za-z]{1,4}-\d{2,})\b/);
  if (qn) header.quote_number = qn[1].trim();

  // Customer / client — the text following a "Bill To" / "Customer" label.
  header.customer = afterLabel(
    text,
    ['bill to', 'sold to', 'customer', 'client', 'company'],
    ['project', 'scope', 're:', 'attn']
  );

  // Project / scope / re: line.
  header.project_name = afterLabel(
    text,
    ['project name', 'project', 're', 'scope of work', 'scope', 'description'],
    ['customer', 'client', 'bill to', 'location']
  );

  // Dates.
  header.issue_date = toIsoDate(afterLabel(text, ['date issued', 'issue date', 'date']));
  header.valid_until = toIsoDate(afterLabel(text, ['valid until', 'valid through', 'expires', 'expiration']));

  // Bid value — prefer a currency amount on a line mentioning "total"; else the
  // largest dollar figure in the document.
  header.bid_value = extractTotal(text);

  return header;
}

/** Pull a total from PDF text: the amount on a "total" line, else the max $. */
function extractTotal(text: string): string {
  const currency = /\$\s*([\d,]+(?:\.\d{1,2})?)/g;
  const lines = text.split(/\n+/);
  // 1) A line that says "total" (but not "subtotal") with a dollar amount.
  for (const line of lines) {
    if (/total/i.test(line) && !/subtotal|sub-total/i.test(line)) {
      const amounts = [...line.matchAll(currency)];
      if (amounts.length) {
        const n = parseNumber(amounts[amounts.length - 1][1]);
        if (n != null) return String(n);
      }
    }
  }
  // 2) Fall back to the largest dollar figure anywhere.
  let max: number | null = null;
  for (const m of text.matchAll(currency)) {
    const n = parseNumber(m[1]);
    if (n != null && (max == null || n > max)) max = n;
  }
  return max == null ? '' : String(max);
}

/* --------------------------------------------------- Excel rows → items */

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Header-name synonyms. Order matters only within a column; the first matching
// spreadsheet column wins. Tune these against a real workbook.
const COLS = {
  description: ['itemdescription', 'description', 'lineitem', 'item', 'scope', 'service', 'workdescription', 'work'],
  quantity: ['qty', 'quantity', 'quan', 'qnty'],
  unit: ['unit', 'uom', 'unitofmeasure', 'units'],
  unit_price: ['unitprice', 'priceeach', 'unitcost', 'rate', 'price', 'each'],
  amount: ['amount', 'linetotal', 'extendedprice', 'extended', 'ext', 'total', 'lineamount'],
  type: ['itemtype', 'type', 'kind'],
  cost_type: ['costtype', 'costcategory', 'category'],
} as const;

const HEADER_COLS = {
  customer: ['customer', 'client', 'customername', 'clientname', 'billto', 'company'],
  quote_number: ['quotenumber', 'quoteno', 'quote', 'proposalnumber', 'proposal', 'estimatenumber', 'bidnumber'],
  project_name: ['projectname', 'project', 'jobname', 'jobtitle', 'job'],
  category: ['category', 'worktype', 'trade'],
} as const;

/** All synonyms across item + header columns, for scoring which row is the header. */
const ALL_SYNONYMS = new Set<string>([
  ...Object.values(COLS).flat(),
  ...Object.values(HEADER_COLS).flat(),
]);

/**
 * Given a sheet as an array-of-arrays (from `XLSX.utils.sheet_to_json(sheet,
 * { header: 1 })`), pick the row index most likely to be the column header by
 * counting how many of its cells match a known synonym. Handles workbooks with
 * title/logo rows above the real header.
 */
export function pickHeaderRow(aoa: unknown[][]): number {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(aoa.length, 15);
  for (let i = 0; i < limit; i++) {
    const row = aoa[i] || [];
    let score = 0;
    for (const cell of row) if (ALL_SYNONYMS.has(norm(cell))) score++;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Map a header row's cells to our known column keys → column index. */
function mapColumns(headerCells: unknown[]) {
  const findIndex = (syns: readonly string[]) => {
    for (const syn of syns) {
      const idx = headerCells.findIndex((c) => norm(c) === syn);
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const items: Record<keyof typeof COLS, number> = {} as never;
  for (const key of Object.keys(COLS) as (keyof typeof COLS)[]) items[key] = findIndex(COLS[key]);
  const headerFields: Record<keyof typeof HEADER_COLS, number> = {} as never;
  for (const key of Object.keys(HEADER_COLS) as (keyof typeof HEADER_COLS)[])
    headerFields[key] = findIndex(HEADER_COLS[key]);
  return { items, headerFields };
}

function normalizeKind(v: unknown, fallback: QuoteItemKind): QuoteItemKind {
  const s = norm(v);
  if (!s) return fallback;
  if (s.startsWith('pric') || s.startsWith('cost') || s.startsWith('internal')) return 'pricing';
  if (s.startsWith('line') || s.startsWith('disp') || s.startsWith('item')) return 'display';
  return fallback;
}

export interface ParsedSheet {
  lines: DraftLine[];
  header: Partial<DraftHeader>;
}

/**
 * Turn a spreadsheet (array-of-arrays) into draft line items plus any header
 * fields it happens to carry (customer / quote # / project / category).
 * `defaultKind` classifies rows with no explicit "Type" column.
 */
export function parseSheet(aoa: unknown[][], defaultKind: QuoteItemKind): ParsedSheet {
  const headerIdx = pickHeaderRow(aoa);
  const headerCells = aoa[headerIdx] || [];
  const { items, headerFields } = mapColumns(headerCells);

  const lines: DraftLine[] = [];
  const header: Partial<DraftHeader> = {};

  const takeHeader = (key: keyof typeof HEADER_COLS, value: string) => {
    if (headerFields[key] >= 0 && value.trim() && !header[key]) header[key] = value.trim();
  };

  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const cell = (idx: number) => (idx >= 0 ? row[idx] : undefined);

    // Capture header-level fields from the first data row that has them.
    takeHeader('customer', String(cell(headerFields.customer) ?? ''));
    takeHeader('quote_number', String(cell(headerFields.quote_number) ?? ''));
    takeHeader('project_name', String(cell(headerFields.project_name) ?? ''));
    takeHeader('category', String(cell(headerFields.category) ?? ''));

    const description = String(cell(items.description) ?? '').trim();
    const qty = parseNumber(cell(items.quantity));
    const unitPrice = parseNumber(cell(items.unit_price));
    const amount = parseNumber(cell(items.amount));

    // Skip rows that carry no line-item content at all.
    if (!description && qty == null && unitPrice == null && amount == null) continue;
    // Skip an obvious totals/summary row (no description but has an amount).
    if (!description) continue;

    lines.push({
      kind: normalizeKind(cell(items.type), defaultKind),
      description,
      quantity: qty == null ? '' : String(qty),
      unit: String(cell(items.unit) ?? '').trim(),
      unit_price: unitPrice == null ? '' : String(unitPrice),
      amount: amount == null ? '' : String(amount),
      cost_type: String(cell(items.cost_type) ?? '').trim(),
    });
  }

  return { lines, header };
}
