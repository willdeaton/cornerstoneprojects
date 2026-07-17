import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listCustomersWithContacts } from '@/lib/data';
import { CustomersManager } from './CustomersManager';

export const dynamic = 'force-dynamic';

export default async function CustomersSettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/dashboard');

  const customers = await listCustomersWithContacts();

  return (
    <div>
      <div className="mb-4">
        <h2 className="brand-heading text-sm text-brand-gray">Customers</h2>
        <p className="text-sm text-brand-gray">
          Saved customers with their address and contacts. These feed the customer picker on the
          New Quote page — pick a customer and their details fill in automatically.
        </p>
      </div>
      <CustomersManager customers={customers} />
    </div>
  );
}
