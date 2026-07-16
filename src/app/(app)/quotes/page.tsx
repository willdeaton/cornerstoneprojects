import Link from 'next/link';
import { listQuotes } from '@/lib/data';
import type { QuoteStatus } from '@/lib/types';
import { money, shortDate } from '@/lib/format';
import { PageHeader, QuoteStatusBadge, EmptyState } from '@/components/ui';
import { AddQuoteButton } from './AddQuoteButton';
import { UploadButton } from './UploadButton';
import { QuoteActions } from './QuoteActions';

export const dynamic = 'force-dynamic';

const TABS: { key: string; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'sold', label: 'Sold' },
  { key: 'lost', label: 'Lost' },
  { key: 'all', label: 'All' },
];

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter = (status ?? 'open') as string;
  const quotes = listQuotes(filter === 'all' ? undefined : (filter as QuoteStatus));
  const total = quotes.reduce((s, q) => s + q.bid_value, 0);

  return (
    <div>
      <PageHeader title="Open Quotes" subtitle="Prospective work in the pipeline">
        <UploadButton />
        <AddQuoteButton />
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-black/10 bg-white p-1">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/quotes?status=${t.key}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                filter === t.key ? 'bg-brand-green text-brand-ink' : 'text-brand-gray hover:bg-black/5'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <p className="text-sm text-brand-gray">
          <span className="font-semibold text-brand-ink">{quotes.length}</span> quotes ·{' '}
          <span className="font-semibold text-brand-ink">{money(total)}</span>
        </p>
      </div>

      {quotes.length === 0 ? (
        <EmptyState
          title="No quotes here yet"
          hint="Add a quote manually or upload this week's spreadsheet."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-black/5 text-left text-xs uppercase tracking-wide text-brand-gray">
                  <th className="px-4 py-3 font-semibold">Customer / Project</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Received</th>
                  <th className="px-4 py-3 text-right font-semibold">Bid Value</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id} className="border-b border-black/5 last:border-0 hover:bg-black/[0.015]">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-brand-ink">{q.customer}</p>
                      {q.project_name && <p className="text-xs text-brand-gray">{q.project_name}</p>}
                    </td>
                    <td className="px-4 py-3 text-brand-gray">{q.category ?? '—'}</td>
                    <td className="px-4 py-3 text-brand-gray">{shortDate(q.date_received)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-brand-ink">
                      {money(q.bid_value)}
                    </td>
                    <td className="px-4 py-3">
                      <QuoteStatusBadge status={q.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
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
