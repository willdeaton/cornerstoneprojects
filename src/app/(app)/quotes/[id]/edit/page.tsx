import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  getQuoteWithItems,
  listCustomersWithContacts,
  listPricingItems,
  listUnits,
  listQuoteFiles,
} from '@/lib/data';
import { PageHeader } from '@/components/ui';
import { QuoteBuilder } from '../../QuoteBuilder';

export const dynamic = 'force-dynamic';

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) notFound();
  const [quote, customers, pricingItems, units, quoteFiles] = await Promise.all([
    getQuoteWithItems(numId),
    listCustomersWithContacts(),
    listPricingItems(),
    listUnits(),
    listQuoteFiles(numId),
  ]);
  if (!quote) notFound();

  return (
    <div>
      <div className="mb-5">
        <Link href="/quotes" className="text-sm font-medium text-brand-gray hover:text-brand-ink">
          ← Back to Quotes
        </Link>
      </div>
      <PageHeader title="Edit Quote" subtitle={quote.customer} />
      <QuoteBuilder
        quote={quote}
        customers={customers}
        pricingItems={pricingItems}
        units={units}
        quoteFiles={quoteFiles}
      />
    </div>
  );
}
