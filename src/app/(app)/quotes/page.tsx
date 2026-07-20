import Link from 'next/link';
import { listQuotes } from '@/lib/data';
import type { QuoteStatus } from '@/lib/types';
import { PageHeader } from '@/components/ui';
import { QuotesTable } from './QuotesTable';

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
  const quotes = await listQuotes(filter === 'all' ? undefined : (filter as QuoteStatus));

  return (
    <div>
      <PageHeader title="Quotes" subtitle="Prospective work in the pipeline">
        <Link href="/quotes/new" className="btn-primary">
          + Create Quote
        </Link>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3">
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
      </div>

      <QuotesTable quotes={quotes} />
    </div>
  );
}
