'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Quote } from '@/lib/types';
import { money, shortDate } from '@/lib/format';
import { QuoteStatusBadge, EmptyState } from '@/components/ui';
import { QuoteActions } from './QuoteActions';

export function QuotesTable({ quotes }: { quotes: Quote[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

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
