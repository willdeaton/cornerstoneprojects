'use client';

import { useState } from 'react';
import { money, shortDate } from '@/lib/format';
import { RECEIPT_CATEGORIES, type ReceiptWithItems } from '@/lib/types';
import {
  categoryTotals,
  itemAmount,
  itemsTotal,
  needsDetails,
  receiptsTotal,
  taxTotal,
  totalsDisagree,
} from '@/lib/receipt-math';

type SortKey = 'purchase_date' | 'vendor' | 'category' | 'tax' | 'total' | 'uploader_name';

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'purchase_date', label: 'Date' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'category', label: 'Category' },
  { key: 'tax', label: 'Tax', align: 'right' },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'uploader_name', label: 'Added by' },
];

/**
 * Order two receipts by one column.
 *
 * Takes the direction rather than letting the caller flip the result, because
 * the empty values must NOT flip with it: a receipt with no date or no vendor
 * is one nobody has finished writing up, and it belongs at the bottom whichever
 * way the column is pointing. Multiplying a "nulls last" result by -1 puts the
 * unfinished rows at the top of the default newest-first view, which is the
 * last thing that should lead the table.
 */
function compare(
  a: ReceiptWithItems,
  b: ReceiptWithItems,
  key: SortKey,
  dir: 'asc' | 'desc'
): number {
  const flip = dir === 'asc' ? 1 : -1;
  switch (key) {
    case 'tax':
      return (a.tax - b.tax) * flip;
    case 'total':
      return (a.total - b.total) * flip;
    case 'purchase_date': {
      const av = a.purchase_date ? Date.parse(`${a.purchase_date}T00:00:00`) : NaN;
      const bv = b.purchase_date ? Date.parse(`${b.purchase_date}T00:00:00`) : NaN;
      const an = Number.isNaN(av);
      const bn = Number.isNaN(bv);
      if (an && bn) return 0;
      if (an) return 1;
      if (bn) return -1;
      return (av - bv) * flip;
    }
    default: {
      const av = a[key] ?? '';
      const bv = b[key] ?? '';
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' }) * flip;
    }
  }
}

/** The receipt's photo at thumbnail size, or what stands in for it. */
function Thumb({ receipt }: { receipt: ReceiptWithItems }) {
  const tile =
    'flex h-10 w-10 items-center justify-center rounded-md border border-surface-line';

  if (!receipt.image_filename) {
    return (
      <span
        className={`${tile} border-dashed text-brand-gray/60`}
        title="No photo on this receipt"
        aria-label="No photo"
      >
        —
      </span>
    );
  }

  const isImage = (receipt.image_mime ?? '').startsWith('image/');
  return (
    <a
      href={`/api/receipts/${receipt.id}/image`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={receipt.image_filename}
      className="inline-block transition hover:opacity-80"
    >
      {isImage && receipt.has_thumb ? (
        // The small copy, not the original — see the image route for why.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/receipts/${receipt.id}/image?size=thumb`}
          alt=""
          loading="lazy"
          className={`${tile} object-cover`}
        />
      ) : (
        <span className={`${tile} bg-black/[0.03] text-[0.6rem] font-semibold text-brand-gray`}>
          {isImage ? 'IMG' : 'PDF'}
        </span>
      )}
    </a>
  );
}

/**
 * Every receipt on the job, and what the job has spent.
 *
 * One row per receipt, because a receipt is the thing you reconcile against;
 * its items open underneath on demand rather than flattening into the table,
 * which would repeat the vendor and date on every line and make the totals
 * impossible to read.
 */
export function ReceiptsTable({
  receipts,
  onEdit,
  onDelete,
  deleting,
}: {
  receipts: ReceiptWithItems[];
  onEdit: (receipt: ReceiptWithItems) => void;
  onDelete: (receipt: ReceiptWithItems) => void;
  deleting: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('purchase_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [open, setOpen] = useState<Set<number>>(new Set());

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Money and dates read best highest/newest first; text A→Z.
      setSortDir(key === 'total' || key === 'tax' || key === 'purchase_date' ? 'desc' : 'asc');
    }
  }

  function toggleRow(id: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const sorted = [...receipts].sort((a, b) => compare(a, b, sortKey, sortDir));
  const jobTotal = receiptsTotal(receipts);
  const jobTax = taxTotal(receipts);
  const byCategory = categoryTotals(receipts);

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-surface-line text-left">
                {/* Expander and thumbnail aren't sortable — nothing to order by. */}
                <th className="w-8 px-2 py-2.5" />
                <th className="w-14 px-4 py-2.5">
                  <span className="eyebrow">Photo</span>
                </th>
                {COLUMNS.map((col) => {
                  const active = sortKey === col.key;
                  return (
                    <th
                      key={col.key}
                      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={`eyebrow whitespace-nowrap px-4 py-2.5 ${
                        col.align === 'right' ? 'text-right' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={`inline-flex items-center gap-1 transition-colors duration-150 hover:text-brand-ink ${
                          active ? 'text-brand-ink' : ''
                        } ${col.align === 'right' ? 'flex-row-reverse' : ''}`}
                      >
                        {col.label}
                        <span
                          aria-hidden
                          className={`text-[0.6rem] leading-none transition-opacity duration-150 ${
                            active ? 'opacity-100' : 'opacity-0'
                          }`}
                        >
                          {sortDir === 'asc' ? '▲' : '▼'}
                        </span>
                      </button>
                    </th>
                  );
                })}
                <th className="w-24 px-4 py-2.5 text-right">
                  <span className="eyebrow">Actions</span>
                </th>
              </tr>
            </thead>

            {/* One tbody per receipt: it keeps the row and its items together as
                one group, which is both valid HTML and the right thing for a
                screen reader to walk. */}
            {sorted.map((r) => {
              const expanded = open.has(r.id);
              const incomplete = needsDetails(r);
              return (
                <tbody key={r.id}>
                  <tr
                    onClick={() => toggleRow(r.id)}
                    className="cursor-pointer border-b border-surface-line transition-colors duration-100 last:border-0 hover:bg-black/[0.02]"
                  >
                    <td className="px-2 py-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRow(r.id);
                        }}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Hide' : 'Show'} items on this receipt`}
                        className="rounded p-1 text-brand-gray transition hover:bg-black/[0.05] hover:text-brand-ink"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          className={`transition-transform duration-150 ${
                            expanded ? 'rotate-90' : ''
                          }`}
                        >
                          <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <Thumb receipt={r} />
                    </td>
                    <td className="tnum whitespace-nowrap px-4 py-3 text-brand-gray">
                      {r.purchase_date ? shortDate(r.purchase_date) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-brand-ink">{r.vendor || 'Unnamed'}</span>
                      {incomplete && (
                        <span
                          className="ml-2 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[0.65rem] font-semibold text-amber-800"
                          title="Vendor, date or total still missing"
                        >
                          Needs details
                        </span>
                      )}
                      {r.note && (
                        <p className="truncate text-xs text-brand-gray">{r.note}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-brand-gray">{r.category}</td>
                    <td className="tnum whitespace-nowrap px-4 py-3 text-right text-brand-gray">
                      {r.tax > 0 ? money(r.tax, { cents: true }) : '—'}
                    </td>
                    <td
                      className={`tnum whitespace-nowrap px-4 py-3 text-right font-semibold ${
                        r.total > 0 ? 'text-brand-ink' : 'text-brand-gray/60'
                      }`}
                    >
                      {money(r.total, { cents: true })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-brand-gray">
                      {r.uploader_name ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(r);
                        }}
                        className="text-xs font-medium text-brand-green-dark transition hover:underline"
                      >
                        edit
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(r);
                        }}
                        disabled={deleting}
                        className="ml-3 text-xs text-red-500 transition hover:underline disabled:opacity-50"
                      >
                        delete
                      </button>
                    </td>
                  </tr>

                  {expanded && (
                    <tr className="border-b border-surface-line last:border-0">
                      <td colSpan={COLUMNS.length + 3} className="bg-black/[0.015] px-4 py-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            {r.items.length === 0 ? (
                              <p className="text-xs text-brand-gray">
                                No line items entered — the total is recorded on its own.
                              </p>
                            ) : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-brand-gray">
                                    <th className="py-1 font-semibold">Description</th>
                                    <th className="py-1 text-right font-semibold">Qty</th>
                                    <th className="py-1 text-right font-semibold">Unit</th>
                                    <th className="py-1 text-right font-semibold">Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.items.map((it) => (
                                    <tr key={it.id} className="border-t border-surface-line">
                                      <td className="py-1.5 pr-3 text-brand-ink">
                                        {it.description}
                                      </td>
                                      <td className="tnum py-1.5 text-right text-brand-gray">
                                        {it.quantity}
                                      </td>
                                      <td className="tnum py-1.5 text-right text-brand-gray">
                                        {money(it.unit_price, { cents: true })}
                                      </td>
                                      <td className="tnum py-1.5 text-right font-medium text-brand-ink">
                                        {money(itemAmount(it), { cents: true })}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>

                          <dl className="shrink-0 space-y-1 text-xs lg:w-52">
                            <Figure label="Subtotal" value={r.subtotal} />
                            <Figure label="Tax" value={r.tax} />
                            <Figure label="Total" value={r.total} strong />
                            {r.items.length > 0 && (
                              <Figure label="Items add to" value={itemsTotal(r.items)} muted />
                            )}
                          </dl>
                        </div>

                        {/* Surfaced, not corrected. The paper's total is what
                            the job counts; a mismatch is worth finding, but a
                            till roll that rounds oddly is still the receipt. */}
                        {totalsDisagree(r) && (
                          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            Subtotal + tax is {money(r.subtotal + r.tax, { cents: true })}, but the
                            total says {money(r.total, { cents: true })}. The total is what counts
                            toward the job.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}

            <tfoot className="border-t-2 border-surface-line bg-surface-sunken/60">
              <tr>
                <td colSpan={5} className="px-4 py-3">
                  <span className="eyebrow">
                    {receipts.length} receipt{receipts.length === 1 ? '' : 's'}
                  </span>
                </td>
                <td className="tnum whitespace-nowrap px-4 py-3 text-right text-brand-gray">
                  {money(jobTax, { cents: true })}
                </td>
                <td className="tnum whitespace-nowrap px-4 py-3 text-right text-base font-bold text-brand-ink">
                  {money(jobTotal, { cents: true })}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Every bucket, including the empty ones: an empty Fuel column is worth
          knowing, and it keeps the row from reflowing as categories appear. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {RECEIPT_CATEGORIES.map((c) => (
          <div key={c} className="rounded-xl border border-surface-line bg-white p-3">
            <p className="eyebrow">{c}</p>
            <p
              className={`tnum mt-0.5 text-lg font-bold ${
                byCategory[c] > 0 ? 'text-brand-ink' : 'text-brand-gray/50'
              }`}
            >
              {money(byCategory[c], { cents: true })}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: number;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={muted ? 'text-brand-gray/70' : 'text-brand-gray'}>{label}</dt>
      <dd
        className={`tnum ${
          strong ? 'text-sm font-bold text-brand-ink' : muted ? 'text-brand-gray/70' : 'text-brand-ink'
        }`}
      >
        {money(value, { cents: true })}
      </dd>
    </div>
  );
}
