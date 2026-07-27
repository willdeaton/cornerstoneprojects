import type { QuoteItemKind } from './types';

/**
 * Quote money math and pricing-option grouping — the one copy shared by the
 * quote builder, the data layer, and the customer PDF.
 *
 * Dependency-free on purpose: the PDF document renders client-side through
 * `renderToStaticMarkup` during a backup export, so nothing here may import the
 * database or any other server-only module.
 */

/** Round to whole cents, so a printed total always equals the sum of its printed lines. */
export const roundCents = (n: number) => Math.round(n * 100) / 100;

/** The shape of a line item this module needs — satisfied by both stored rows and drafts. */
export interface MathLine {
  kind?: QuoteItemKind;
  option_group?: string | null;
  amount?: number | null;
  quantity?: number;
  unit_price?: number;
  markup_rate?: number;
}

/** Total price of one line: an explicit amount if set, else quantity × unit price. */
export function lineAmount(it: MathLine): number {
  if (it.amount != null) return it.amount;
  return (it.quantity || 0) * (it.unit_price || 0);
}

/** What the customer sees for one line: its amount grown by its own markup, to cents. */
export function shownAmount(it: MathLine): number {
  return roundCents(lineAmount(it) * (1 + (it.markup_rate || 0)));
}

/** Subtotal / markup / total for one block of customer-facing lines. */
export function blockTotals(rows: MathLine[]): { subtotal: number; markup: number; total: number } {
  const subtotal = rows.reduce((s, r) => s + lineAmount(r), 0);
  const total = rows.reduce((s, r) => s + shownAmount(r), 0);
  return { subtotal, markup: total - subtotal, total };
}

/** One pricing option: a named group of customer-facing lines, totalled on its own. */
export interface QuoteOptionGroup<T> {
  name: string;
  rows: T[];
  /**
   * True for a pre-`option_group` row — a single-line option imported before
   * options had line items. Each one stands alone as its own group.
   */
  legacy: boolean;
}

/** A line item's effective kind. Rows saved before the kinds split have none. */
const kindOf = (it: MathLine): QuoteItemKind => it.kind ?? 'display';

/**
 * Split line items into the base customer-facing lines and the pricing-option
 * groups. Groups keep first-appearance order, so callers that read rows in
 * `position` order see options in the order they were saved.
 *
 * A legacy `alternate` row (no `option_group`) becomes its OWN single-line group
 * rather than joining the other ungrouped rows — bucketing them together would
 * sum several unrelated options into one price.
 */
export function groupQuoteLines<T extends MathLine>(
  items: T[]
): { base: T[]; groups: QuoteOptionGroup<T>[] } {
  const base: T[] = [];
  const groups: QuoteOptionGroup<T>[] = [];
  const byName = new Map<string, QuoteOptionGroup<T>>();

  for (const it of items) {
    const kind = kindOf(it);
    if (kind === 'pricing') continue;
    if (kind !== 'alternate') {
      base.push(it);
      continue;
    }
    const name = (it.option_group ?? '').trim();
    if (!name) {
      // Legacy single-line option — its own group, so it can never merge with another.
      groups.push({ name: '', rows: [it], legacy: true });
      continue;
    }
    const existing = byName.get(name);
    if (existing) {
      existing.rows.push(it);
      continue;
    }
    const group: QuoteOptionGroup<T> = { name, rows: [it], legacy: false };
    byName.set(name, group);
    groups.push(group);
  }

  return { base, groups };
}

/** Each option group's total, in the order the groups appear. */
export function optionGroupTotals(items: MathLine[]): { name: string; total: number }[] {
  return groupQuoteLines(items).groups.map((g) => ({
    name: g.name,
    total: blockTotals(g.rows).total,
  }));
}
