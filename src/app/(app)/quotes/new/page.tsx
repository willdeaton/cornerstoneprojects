import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listCustomersWithContacts, listPricingItems } from '@/lib/data';
import { PageHeader } from '@/components/ui';
import { QuoteBuilder } from '../QuoteBuilder';

export const dynamic = 'force-dynamic';

export default async function NewQuotePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [customers, pricingItems] = await Promise.all([
    listCustomersWithContacts(),
    listPricingItems(),
  ]);

  return (
    <div>
      <PageHeader title="New Quote" subtitle="Build a customer quote from scratch" />
      <QuoteBuilder customers={customers} pricingItems={pricingItems} />
    </div>
  );
}
