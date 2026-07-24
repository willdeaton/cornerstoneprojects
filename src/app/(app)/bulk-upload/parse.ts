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
import { bulletsToRichText } from '@/lib/richtext';

/** Where a draft line came from — lets us swap out imported rows without
 *  touching rows the user typed or that came from a different source. */
export type LineSource = 'manual' | 'excel' | 'pdf';

/** One editable line-item row in the Bulk Upload card (all values as strings). */
export interface DraftLine {
  kind: QuoteItemKind;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  amount: string;
  cost_type: string;
  /** Origin of the row; defaults to 'manual' for hand-added rows. */
  source: LineSource;
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

/* ------------------------------------ positioned PDF text → visual lines */

/** A text fragment from pdf.js `getTextContent()`, reduced to what we need to
 *  rebuild visual lines: the string and its baseline position. */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
}

/**
 * Rebuild visual text lines from positioned PDF fragments. pdf.js yields text
 * in reading order but without reliable line breaks, so we group fragments
 * whose baseline (y) is within `tol` points, order each line left-to-right, and
 * return trimmed non-empty lines top-to-bottom. This gives the fixed proposal
 * template a stable line structure to anchor on.
 */
export function groupItemsIntoLines(items: PdfTextItem[], tol = 3): string[] {
  const rows: { y: number; items: PdfTextItem[] }[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const row = rows.find((r) => Math.abs(r.y - it.y) <= tol);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y); // PDF y grows upward → top of page first
  return rows
    .map((r) =>
      r.items
        .sort((a, b) => a.x - b.x)
        .map((i) => i.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((s) => s.length > 0);
}

/* ------------------------------ proposal PDF (fixed Cornerstone template) */

export interface ProposalExtract {
  /** quote_number, customer, project_name, issue_date, bid_value (best-effort). */
  header: Partial<DraftHeader>;
  contact: string;
  address: string;
  /** Scope-of-work bullets (glyphs stripped); they become the line description. */
  scopeBullets: string[];
  /** "Notes to Client" section, one note per line → the quote's customer notes. */
  clientNotes: string;
  /** One line per price in the Quote section: 'alternate' when there are
   *  several (full-price options), 'display' when there's just one (base bid). */
  lines: DraftLine[];
}

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';
const LONG_DATE_RE = new RegExp(`\\b(\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{4})\\b`, 'i');

/**
 * End-client name from the addressee company line: the text after the last "/"
 * or spaced dash (e.g. `Cornerstone Facilities/Sonoco Products` → `Sonoco
 * Products`), else the whole line. Editable in the UI afterwards.
 */
export function endClient(company: string): string {
  const c = company.trim();
  const slash = c.lastIndexOf('/');
  if (slash >= 0) return c.slice(slash + 1).trim();
  const dash = c.match(/\s[–—-]\s(.+)$/);
  if (dash) return dash[1].trim();
  return c;
}

/**
 * Extract the fixed Cornerstone/HMC "SERVICE PROPOSAL" fields from reconstructed
 * text lines. Anchors: `Quote# NN-NNNN`, a "D Month YYYY" date near the top,
 * the `RE:` subject (project title), the `Scope of Work:` bullets, and every `$`
 * amount in the `Quote:`→`Exclusions:` span (each becomes a line item). All
 * values are best-effort and editable; empty fields fall back to the generic
 * `extractHeaderFromPdfText` in the caller.
 */
export function extractProposal(lines: string[]): ProposalExtract {
  const header: Partial<DraftHeader> = {};
  let contact = '';
  let address = '';
  let scopeBullets: string[] = [];
  let clientNotes = '';
  const draft: DraftLine[] = [];
  const text = lines.join('\n');

  // Quote number (YY-NNNN), tolerant of "Quote#" / "Quote #".
  const qn = text.match(/quote\s*#?\s*[:#-]?\s*(\d{2}-\d{3,4})/i);
  if (qn) header.quote_number = qn[1];

  // Issue date — a "16 October 2025" style date, else a numeric one.
  const dm = text.match(LONG_DATE_RE) || text.match(/\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\b/);
  if (dm) header.issue_date = toIsoDate(dm[1]);

  // RE: subject line → project / description.
  const reLine = lines.find((l) => /^\s*re\s*[:\-]/i.test(l));
  if (reLine) header.project_name = reLine.replace(/^\s*re\s*[:\-]\s*/i, '').trim();

  // Contact / customer / address sit between the quote-number line and RE:.
  const quoteLineIdx = lines.findIndex((l) => /quote\s*#/i.test(l) || /quote#/i.test(l));
  const reIdx = lines.findIndex((l) => /^\s*re\s*[:\-]/i.test(l));
  if (quoteLineIdx >= 0 && reIdx > quoteLineIdx) {
    const block = lines.slice(quoteLineIdx + 1, reIdx).map((l) => l.trim()).filter(Boolean);
    if (block[0]) contact = block[0].replace(/^(mr|mrs|ms|dr)\.?\s+/i, '').trim();
    if (block[1]) header.customer = endClient(block[1]);
    if (block.length > 2) address = block.slice(2).join(', ');
  }

  // Split a section's text into clean bullet strings ("*", "•", "-" glyphs off).
  const toBullets = (section: string): string[] =>
    section
      .split(/\n|•|•/)
      .map((s) => s.replace(/^[\s•\-*]+/, '').trim())
      .filter(Boolean);

  // Scope of Work → bullets, up to the pricing / notes / closing sections.
  const scopeMatch = text.match(
    /scope of work\s*:?\s*([\s\S]*?)(?=quote\s*:|notes to client|exclusions|conditions|total\s*:|accepted by|$)/i
  );
  if (scopeMatch) scopeBullets = toBullets(scopeMatch[1]);

  // Some proposals skip the "Scope of Work:" label and list the work as
  // bulleted lines right under the project heading — collect those instead,
  // stopping before the Notes to Client / totals / signature sections.
  if (scopeBullets.length === 0) {
    let stop = lines.findIndex((l) =>
      /^\s*(notes to client|total\s*:|accepted by|exclusions|conditions)/i.test(l)
    );
    if (stop < 0) stop = lines.length;
    scopeBullets = lines
      .slice(0, stop)
      .filter((l) => /^\s*[*•▪‣]\s*\S|^\s*-\s+\S/.test(l))
      .map((l) => l.replace(/^[\s•▪‣\-*]+/, '').trim())
      .filter(Boolean);
  }

  // "Notes to Client" → customer notes shown on the quote, one note per line.
  const notesMatch = text.match(
    /notes to client\s*:?\s*([\s\S]*?)(?=total\s*:|accepted by|exclusions|conditions|$)/i
  );
  if (notesMatch) clientNotes = toBullets(notesMatch[1]).join('\n');

  // Prices → line items: every $ amount in the Quote:→Exclusions: span.
  const priceSection = text.match(
    /quote\s*:\s*([\s\S]*?)(?=exclusions|conditions|$)/i
  );
  const priceText = priceSection ? priceSection[1] : '';
  const amounts: number[] = [];
  for (const m of priceText.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g)) {
    const n = parseNumber(m[1]);
    if (n != null && n > 0) amounts.push(n);
  }
  // Scope bullets become a bullet-list description (same HTML the quote
  // builder's rich-text editor produces), so the quote prints them as bullets.
  const desc = bulletsToRichText(scopeBullets) || header.project_name || '';
  // One price → a normal base line; multiple → full-price options (alternates)
  // so they aren't summed into the total.
  const kind: QuoteItemKind = amounts.length > 1 ? 'alternate' : 'display';
  for (const amt of amounts) {
    draft.push({
      kind,
      description: desc,
      quantity: '',
      unit: '',
      unit_price: '',
      amount: String(amt),
      cost_type: '',
      source: 'pdf',
    });
  }
  if (amounts.length) header.bid_value = String(amounts[0]);

  // No labelled "Quote:" price section but the scope was found — make one base
  // line from the document total so the bullets still land on the quote.
  if (draft.length === 0 && scopeBullets.length > 0) {
    const total = extractTotal(text);
    draft.push({
      kind: 'display',
      description: desc,
      quantity: '',
      unit: '',
      unit_price: '',
      amount: total,
      cost_type: '',
      source: 'pdf',
    });
    if (total) header.bid_value = total;
  }

  return { header, contact, address, scopeBullets, clientNotes, lines: draft };
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
  if (s.startsWith('alt') || s.startsWith('opt')) return 'alternate';
  if (s.startsWith('line') || s.startsWith('disp') || s.startsWith('item')) return 'display';
  return fallback;
}

export interface ParsedSheet {
  lines: DraftLine[];
  header: Partial<DraftHeader>;
}

/**
 * Summary / section-label cells on the estimate template that look like data
 * rows but aren't line items. Compared against the trimmed, lower-cased
 * description. Extend as new junk labels turn up.
 */
const IGNORE_DESCRIPTIONS = new Set([
  'total',
  'subtotal',
  'grand total',
  'percentage of bid amount before bond',
  'name',
  'quote $',
  'quote$',
]);

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
    // Skip the estimate template's summary/section labels — they aren't line items.
    if (IGNORE_DESCRIPTIONS.has(description.toLowerCase())) continue;

    lines.push({
      kind: normalizeKind(cell(items.type), defaultKind),
      description,
      quantity: qty == null ? '' : String(qty),
      unit: String(cell(items.unit) ?? '').trim(),
      unit_price: unitPrice == null ? '' : String(unitPrice),
      amount: amount == null ? '' : String(amount),
      cost_type: String(cell(items.cost_type) ?? '').trim(),
      source: 'excel',
    });
  }

  return { lines, header };
}
