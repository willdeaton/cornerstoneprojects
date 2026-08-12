import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listCustomersWithContacts, listPricingItems, listUnits, listCategories } from '@/lib/data';
import { getCompanySettings } from '@/lib/company';
import { PageHeader } from '@/components/ui';
import { QuoteBuilder } from '../QuoteBuilder';

export const dynamic = 'force-dynamic';

export default async function NewQuotePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role === 'employee') redirect('/time');

  const [customers, pricingItems, units, categories, company] = await Promise.all([
    listCustomersWithContacts(),
    listPricingItems(),
    listUnits(),
    listCategories(),
    getCompanySettings(),
  ]);

  return (
    <div>
      <PageHeader title="New Quote" subtitle="Build a customer quote from scratch" />
      <QuoteBuilder
        customers={customers}
        pricingItems={pricingItems}
        units={units}
        categories={categories}
        defaultTerms={company.default_terms ?? ''}
        currentUserName={user.name}
      />
    </div>
  );
}
