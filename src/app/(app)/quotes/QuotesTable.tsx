'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Quote } from '@/lib/types';
import { money, shortDate } from '@/lib/format';
import { QuoteStatusBadge, EmptyState } from '@/components/ui';
import { QuoteActions } from './QuoteActions';

type SortKey =
  | 'quote_number'
  | 'customer'
  | 'project_name'
  | 'category'
  | 'date_received'
  | 'bid_value'
  | 'status';
type SortDir = 'asc' | 'desc';

const STATUS_ORDER: Record<Quote['status'], number> = { open: 0, sold: 1, lost: 2 };

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'quote_number', label: 'Quote #' },
  { key: 'customer', label: 'Customer' },
  { key: 'project_name', label: 'Project' },
  { key: 'category', label: 'Category' },
  { key: 'date_received', label: 'Received' },
  { key: 'bid_value', label: 'Bid Value', align: 'right' },
  { key: 'status', label: 'Status' },
];

function compare(a: Quote, b: Quote, key: SortKey): number {
  switch (key) {
    case 'bid_value':
      return a.bid_value - b.bid_value;
    case 'status':
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    case 'date_received': {
      // Sort chronologically; nulls sort last.
      const av = a.date_received ? Date.parse(a.date_received) : NaN;
      const bv = b.date_received ? Date.parse(b.date_received) : NaN;
      const an = Number.isNaN(av);
      const bn = Number.isNaN(bv);
      if (an && bn) return 0;
      if (an) return 1;
      if (bn) return -1;
      return av - bv;
    }
    default: {
      // String columns; nulls/empties sort last.
      const av = (a[key] ?? '') as string;
      const bv = (b[key] ?? '') as string;
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
    }
  }
}

export function QuotesTable({ quotes }: { quotes: Quote[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('date_received');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

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

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const c = compare(a, b, sortKey);
      // Keep a stable tiebreak by id so equal rows don't jump around.
      return c !== 0 ? c * dir : a.id - b.id;
    });
  }, [filtered, sortKey, sortDir]);

  const total = filtered.reduce((s, q) => s + q.bid_value, 0);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Numbers and dates feel most useful highest-first; text A→Z.
      setSortDir(key === 'bid_value' || key === 'date_received' ? 'desc' : 'asc');
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
                  {COLUMNS.map((col) => {
                    const active = sortKey === col.key;
                    return (
                      <th
                        key={col.key}
                        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        className={`px-4 py-3 font-semibold ${col.align === 'right' ? 'text-right' : ''}`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-brand-ink ${
                            active ? 'text-brand-ink' : ''
                          } ${col.align === 'right' ? 'flex-row-reverse' : ''}`}
                        >
                          {col.label}
                          <span aria-hidden className="text-[0.65rem] leading-none">
                            {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((q) => (
                  <tr
                    key={q.id}
                    onClick={() => router.push(`/quotes/${q.id}/edit`)}
                    className="cursor-pointer border-b border-black/5 last:border-0 hover:bg-black/[0.015]"
                  >
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
