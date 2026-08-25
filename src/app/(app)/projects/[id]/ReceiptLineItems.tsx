'use client';

import { money } from '@/lib/format';
import { itemAmount, itemsTotal } from '@/lib/receipt-math';

/**
 * One editable line off a receipt.
 *
 * `key` is carried on the row rather than derived from the array index, so
 * removing the second of four rows doesn't make React reuse the wrong inputs.
 */
export interface ItemRow {
  key: string;
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
}

let seq = 0;
export function blankItemRow(): ItemRow {
  seq += 1;
  return { key: `new-${seq}`, description: '', quantity: '', unit_price: '', amount: '' };
}

/** Turn saved items back into editable rows. Blank beats "0" in an input. */
export function toItemRows(
  items: { description: string; quantity: number; unit_price: number; amount: number | null }[]
): ItemRow[] {
  return items.map((it) => {
    seq += 1;
    return {
      key: `saved-${seq}`,
      description: it.description,
      quantity: it.quantity ? String(it.quantity) : '',
      unit_price: it.unit_price ? String(it.unit_price) : '',
      amount: it.amount ? String(it.amount) : '',
    };
  });
}

function num(v: string): number {
  const n = parseFloat(v.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * What was on the receipt, typed line by line.
 *
 * Zero rows is a perfectly good answer — plenty of receipts are worth recording
 * as a vendor and a total and nothing more — so this never insists on one.
 */
export function ReceiptLineItems({
  rows,
  onChange,
}: {
  rows: ItemRow[];
  onChange: (rows: ItemRow[]) => void;
}) {
  const sum = itemsTotal(
    rows.map((r) => ({
      quantity: num(r.quantity),
      unit_price: num(r.unit_price),
      amount: num(r.amount) || null,
    }))
  );

  function update(key: string, patch: Partial<ItemRow>) {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="eyebrow">Items</p>
        {sum > 0 && (
          <p className="tnum text-xs text-brand-gray">
            Items add to {money(sum, { cents: true })}
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-surface-line-strong px-3 py-3 text-center text-xs text-brand-gray">
          No items — a vendor and a total is enough.
        </p>
      ) : (
        <div className="space-y-2">
          {/* Column headings only once, and only where there's room for them. */}
          <div className="hidden gap-2 px-1 sm:grid sm:grid-cols-[1fr_4.5rem_6rem_6rem_1.75rem]">
            <span className="eyebrow">Description</span>
            <span className="eyebrow text-right">Qty</span>
            <span className="eyebrow text-right">Unit price</span>
            <span className="eyebrow text-right">Amount</span>
            <span />
          </div>

          {rows.map((row) => {
            const qty = num(row.quantity);
            const price = num(row.unit_price);
            const computed = itemAmount({ quantity: qty || 1, unit_price: price, amount: null });
            return (
              <div
                key={row.key}
                className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_4.5rem_6rem_6rem_1.75rem]"
              >
                {/*
                  Every row renders all four inputs, always — even when empty.
                  The action zips these back together by index (see parseItems),
                  so a skipped input on one row would shift every row after it.
                */}
                <input
                  className="input col-span-2 sm:col-span-1"
                  placeholder="e.g. 2x4x8 PT lumber"
                  value={row.description}
                  onChange={(e) => update(row.key, { description: e.target.value })}
                  name="item_desc"
                />
                <input
                  className="input tnum text-right"
                  inputMode="decimal"
                  placeholder="1"
                  value={row.quantity}
                  onChange={(e) => update(row.key, { quantity: e.target.value })}
                  name="item_qty"
                  aria-label="Quantity"
                />
                <input
                  className="input tnum text-right"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={row.unit_price}
                  onChange={(e) => update(row.key, { unit_price: e.target.value })}
                  name="item_price"
                  aria-label="Unit price"
                />
                {/* Left blank on purpose: the placeholder shows what qty x price
                    comes to, so typing here is an override, not a chore. */}
                <input
                  className="input tnum text-right"
                  inputMode="decimal"
                  placeholder={computed ? computed.toFixed(2) : '0.00'}
                  value={row.amount}
                  onChange={(e) => update(row.key, { amount: e.target.value })}
                  name="item_amount"
                  aria-label="Amount"
                />
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                  className="justify-self-end rounded-lg p-1.5 text-brand-gray transition hover:bg-black/[0.05] hover:text-red-600"
                  aria-label={`Remove ${row.description || 'this item'}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => onChange([...rows, blankItemRow()])}
        className="mt-2 text-sm font-semibold text-brand-green-dark transition hover:underline"
      >
        + Add item
      </button>
    </div>
  );
}
