import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { BackupPanel } from './BackupPanel';

export const dynamic = 'force-dynamic';

export default async function BackupSettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/dashboard');

  return (
    <div>
      <div className="mb-4">
        <h2 className="brand-heading text-sm text-brand-gray">Backup / Export</h2>
        <p className="text-sm text-brand-gray">
          Pick a date range and download a single ZIP with a spreadsheet of every quote, project and
          time record from that period — plus a PDF of each quote. Customers and the pricing catalog
          are always included as reference data.
        </p>
      </div>
      <BackupPanel />
    </div>
  );
}
