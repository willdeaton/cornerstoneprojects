import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getQuoteWithItems, listCustomersWithContacts, listPricingItems } from '@/lib/data';
import { PageHeader } from '@/components/ui';
import { QuoteBuilder } from '../../QuoteBuilder';

export const dynamic = 'force-dynamic';

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) notFound();
  const [quote, customers, pricingItems] = await Promise.all([
    getQuoteWithItems(numId),
    listCustomersWithContacts(),
    listPricingItems(),
  ]);
  if (!quote) notFound();

  return (
    <div>
      <PageHeader title="Edit Quote" subtitle={quote.customer} />
      <QuoteBuilder quote={quote} customers={customers} pricingItems={pricingItems} />
    </div>
  );
}
