'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Quote } from '@/lib/types';
import { money, shortDate } from '@/lib/format';
import { QuoteStatusBadge, EmptyState } from '@/components/ui';
import { QuoteActions } from './QuoteActions';
import {
  bulkDeleteQuotesAction,
  bulkMarkQuotesLostAction,
  bulkMarkQuotesSoldAction,
} from '@/app/actions/quotes';

export function QuotesTable({ quotes }: { quotes: Quote[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(
    () =>
      (Array.from(new Set(quotes.map((q) => q.category).filter(Boolean))) as string[]).sort(
        (a, b) => a.localeCompare(b),
      ),
    [quotes],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotes.filter((quote) => {
      if (category !== 'all' && quote.category !== category) return false;
      if (!q) return true;
      return [quote.quote_number, quote.customer, quote.project_name, quote.category]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [quotes, search, category]);

  const total = filtered.reduce((s, q) => s + q.bid_value, 0);

  // Selection is scoped to the currently filtered rows so bulk actions never
  // touch quotes the user can't see. Prune any ids that drop out of the filter.
  const filteredIds = useMemo(() => filtered.map((q) => q.id), [filtered]);
  useEffect(() => {
    setSelected((prev) => {
      const allowed = new Set(filteredIds);
      const next = new Set<number>();
      for (const id of prev) if (allowed.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [filteredIds]);

  const selectedQuotes = filtered.filter((q) => selected.has(q.id));
  const selectedIds = selectedQuotes.map((q) => q.id);
  const openSelectedIds = selectedQuotes.filter((q) => q.status === 'open').map((q) => q.id);
  const allSelected = filtered.length > 0 && selected.size === filtered.length;
  const someSelected = selected.size > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filteredIds)));
  }

  async function runBulk(fn: () => Promise<unknown>) {
    setBusy(true);
    await fn();
    setSelected(new Set());
    setBusy(false);
    router.refresh();
  }

  function bulkMarkSold() {
    if (openSelectedIds.length === 0) return;
    if (
      confirm(
        `Mark ${openSelectedIds.length} quote${openSelectedIds.length === 1 ? '' : 's'} sold and create a project for each?`,
      )
    ) {
      void runBulk(() => bulkMarkQuotesSoldAction(openSelectedIds));
    }
  }

  function bulkMarkLost() {
    if (openSelectedIds.length === 0) return;
    void runBulk(() => bulkMarkQuotesLostAction(openSelectedIds));
  }

  function bulkDelete() {
    if (selectedIds.length === 0) return;
    if (
      confirm(
        `Delete ${selectedIds.length} quote${selectedIds.length === 1 ? '' : 's'}? This cannot be undone.`,
      )
    ) {
      void runBulk(() => bulkDeleteQuotesAction(selectedIds));
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          className="input sm:w-72"
          placeholder="Search customer, project, quote #…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input sm:w-52"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <p className="text-sm text-brand-gray sm:ml-auto">
          <span className="font-semibold text-brand-ink">{filtered.length}</span> quotes ·{' '}
          <span className="font-semibold text-brand-ink">{money(total)}</span>
        </p>
      </div>

      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-brand-green/40 bg-brand-green/10 px-4 py-2.5">
          <span className="text-sm font-semibold text-brand-ink">
            {selected.size} selected
          </span>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <button
              className="btn-secondary text-sm disabled:opacity-50"
              onClick={bulkMarkSold}
              disabled={busy || openSelectedIds.length === 0}
              title={openSelectedIds.length === 0 ? 'Only open quotes can be marked sold' : undefined}
            >
              Mark Sold{openSelectedIds.length ? ` (${openSelectedIds.length})` : ''}
            </button>
            <button
              className="btn-secondary text-sm disabled:opacity-50"
              onClick={bulkMarkLost}
              disabled={busy || openSelectedIds.length === 0}
              title={openSelectedIds.length === 0 ? 'Only open quotes can be marked lost' : undefined}
            >
              Mark Lost{openSelectedIds.length ? ` (${openSelectedIds.length})` : ''}
            </button>
            <button
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
              onClick={bulkDelete}
              disabled={busy}
            >
              Delete
            </button>
            <button
              className="text-sm font-semibold text-brand-gray underline disabled:opacity-50"
              onClick={() => setSelected(new Set())}
              disabled={busy}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          title={quotes.length === 0 ? 'No quotes here yet' : 'No quotes match'}
          hint={
            quotes.length === 0
              ? "Add a quote manually or upload this week's spreadsheet."
              : 'Try a different search or category filter.'
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-black/5 text-left text-xs uppercase tracking-wide text-brand-gray">
                  <th className="w-10 px-4 py-3">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer align-middle"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all quotes"
                    />
                  </th>
                  <th className="px-4 py-3 font-semibold">Quote #</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Project</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Received</th>
                  <th className="px-4 py-3 text-right font-semibold">Bid Value</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => (
                  <tr
                    key={q.id}
                    onClick={() => router.push(`/quotes/${q.id}/edit`)}
                    className={`cursor-pointer border-b border-black/5 last:border-0 hover:bg-black/[0.015] ${
                      selected.has(q.id) ? 'bg-brand-green/5' : ''
                    }`}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer align-middle"
                        checked={selected.has(q.id)}
                        onChange={() => toggle(q.id)}
                        aria-label={`Select quote ${q.quote_number ?? q.customer}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-semibold text-brand-ink">
                      {q.quote_number ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-semibold text-brand-ink">{q.customer}</td>
                    <td className="px-4 py-3 text-brand-gray">{q.project_name ?? '—'}</td>
                    <td className="px-4 py-3 text-brand-gray">{q.category ?? '—'}</td>
                    <td className="px-4 py-3 text-brand-gray">{shortDate(q.date_received)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-brand-ink">
                      {money(q.bid_value)}
                    </td>
                    <td className="px-4 py-3">
                      <QuoteStatusBadge status={q.status} />
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <QuoteActions id={q.id} status={q.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
