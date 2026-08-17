import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listSubcontractors } from '@/lib/schedule-data';
import { SubcontractorsManager } from './SubcontractorsManager';

export const dynamic = 'force-dynamic';

export default async function SubcontractorsSettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/dashboard');

  const subs = await listSubcontractors();

  return (
    <div>
      <div className="mb-4">
        <h2 className="brand-heading text-sm text-brand-gray">Subcontractors</h2>
        <p className="text-sm text-brand-gray">
          The subs you schedule work with. Anyone here can be assigned to a phase on the Schedule,
          and subs with an email address can be sent their schedule along with your crew.
        </p>
      </div>
      <SubcontractorsManager subs={subs} />
    </div>
  );
}
