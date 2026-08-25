import { RECEIPT_CATEGORIES, type ReceiptCategory } from './types';

/*
 * Receipt arithmetic, in one place and deliberately not on the server.
 *
 * The Receipts tab totals rows it has already loaded, so none of this needs a
 * query — and keeping it out of the components means the table's footer and the
 * form's live hints cannot drift into disagreeing about what a receipt adds to.
 *
 * Every accumulation is rounded to cents. The money columns are DOUBLE
 * PRECISION (see migrateReceipts for why), so a page of them summed raw shows
 * $1,204.9700000001 often enough to matter.
 */

/** Round to cents. Money is only ever compared or displayed after this. */
export function cents(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Read a typed money value: `$1,234.56`, `1234.56`, `  12 ` all work.
 *
 * Returns 0 for anything that isn't a usable positive number, so a stray
 * keystroke reads as "not filled in" rather than poisoning a total with NaN.
 */
export function parseMoney(v: unknown): number {
  if (typeof v === 'number') return v > 0 && Number.isFinite(v) ? cents(v) : 0;
  if (typeof v !== 'string') return 0;
  const n = parseFloat(v.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? cents(n) : 0;
}

/** What one line comes to: its own amount if given, else qty x unit price. */
export function itemAmount(it: {
  quantity: number;
  unit_price: number;
  amount: number | null;
}): number {
  if (it.amount !== null && it.amount !== undefined) return cents(it.amount);
  return cents((it.quantity || 0) * (it.unit_price || 0));
}

/** What the lines add to — which is not necessarily what the receipt says. */
export function itemsTotal(items: {
  quantity: number;
  unit_price: number;
  amount: number | null;
}[]): number {
  return cents(items.reduce((sum, it) => sum + itemAmount(it), 0));
}

/** The job's receipt spend. Sums `total` — the paper's own number. */
export function receiptsTotal(rs: { total: number }[]): number {
  return cents(rs.reduce((sum, r) => sum + (r.total || 0), 0));
}

/** Sales tax across the job's receipts, for the footer. */
export function taxTotal(rs: { tax: number }[]): number {
  return cents(rs.reduce((sum, r) => sum + (r.tax || 0), 0));
}

/**
 * Spend per cost bucket, every bucket present.
 *
 * Categories with nothing in them are kept at 0 rather than omitted: an empty
 * Fuel bucket is information, and it stops the footer's tiles reflowing every
 * time a receipt in a new category is added.
 */
export function categoryTotals(
  rs: { category: ReceiptCategory; total: number }[]
): Record<ReceiptCategory, number> {
  const out = Object.fromEntries(RECEIPT_CATEGORIES.map((c) => [c, 0])) as Record<
    ReceiptCategory,
    number
  >;
  for (const r of rs) {
    // A category from the database that isn't in the list can only mean the two
    // have drifted; bucket it rather than dropping the money on the floor.
    const key = (RECEIPT_CATEGORIES as readonly string[]).includes(r.category)
      ? r.category
      : 'Other';
    out[key as ReceiptCategory] = cents(out[key as ReceiptCategory] + (r.total || 0));
  }
  return out;
}

/**
 * A receipt somebody photographed but hasn't finished writing up.
 *
 * Derived, never stored — the emptiness of the fields IS the state, so there is
 * no flag that can disagree with them.
 */
export function needsDetails(r: {
  vendor: string | null;
  purchase_date: string | null;
  total: number;
}): boolean {
  return !r.vendor?.trim() || !r.purchase_date || !(r.total > 0);
}

/**
 * Whether subtotal + tax disagrees with the typed total.
 *
 * Only meaningful when both sides were actually filled in — a receipt entered
 * as a bare total is not in disagreement with anything. Never blocks a save;
 * the paper is the authority and vendors round oddly.
 */
export function totalsDisagree(r: { subtotal: number; tax: number; total: number }): boolean {
  if (!(r.total > 0)) return false;
  if (!(r.subtotal > 0) && !(r.tax > 0)) return false;
  return Math.abs(r.subtotal + r.tax - r.total) > 0.01;
}
