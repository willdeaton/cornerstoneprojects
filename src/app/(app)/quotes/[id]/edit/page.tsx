import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  getQuoteWithItems,
  listCustomersWithContacts,
  listPricingItems,
  listUnits,
  listCategories,
  listQuoteFiles,
} from '@/lib/data';
import { PageHeader } from '@/components/ui';
import { BackToList } from '@/components/ListMemory';
import { QuoteBuilder } from '../../QuoteBuilder';

export const dynamic = 'force-dynamic';

export default async function EditQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role === 'employee') redirect('/time');

  const { id } = await params;
  const { saved } = await searchParams;
  const numId = Number(id);
  if (!Number.isFinite(numId)) notFound();
  const [quote, customers, pricingItems, units, categories, quoteFiles] = await Promise.all([
    getQuoteWithItems(numId),
    listCustomersWithContacts(),
    listPricingItems(),
    listUnits(),
    listCategories(),
    listQuoteFiles(numId),
  ]);
  if (!quote) notFound();

  return (
    <div>
      <div className="mb-5">
        <BackToList
          listKey="quotes"
          fallback="/quotes"
          className="text-sm font-medium text-brand-gray hover:text-brand-ink"
        >
          ← Back to Quotes
        </BackToList>
      </div>
      <PageHeader title="Edit Quote" subtitle={quote.customer} />
      <QuoteBuilder
        quote={quote}
        customers={customers}
        pricingItems={pricingItems}
        units={units}
        categories={categories}
        quoteFiles={quoteFiles}
        initialSaved={saved === '1'}
      />
    </div>
  );
}
