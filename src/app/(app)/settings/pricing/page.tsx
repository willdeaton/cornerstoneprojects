import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listPricingItems, listUnits } from '@/lib/data';
import { PricingManager } from './PricingManager';

export const dynamic = 'force-dynamic';

export default async function PricingSettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/dashboard');

  const [items, units] = await Promise.all([listPricingItems(), listUnits()]);

  return (
    <div>
      <div className="mb-4">
        <h2 className="brand-heading text-sm text-brand-gray">Pricing Line Items</h2>
        <p className="text-sm text-brand-gray">
          A price book of line items with a default unit and unit price. Drop these into the pricing
          worksheet on the New Quote page to build a quote quickly.
        </p>
      </div>
      <PricingManager items={items} units={units} />
    </div>
  );
}
