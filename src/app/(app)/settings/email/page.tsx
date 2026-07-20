import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { EmailSettings } from '../EmailSettings';

export const dynamic = 'force-dynamic';

export default async function EmailSettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') redirect('/dashboard');

  return (
    <div className="max-w-2xl">
      <div className="card p-6">
        <h2 className="brand-heading mb-1 text-sm text-brand-gray">Email Settings</h2>
        <p className="mb-5 text-sm text-brand-gray">
          Sender identity for automated notifications (reminders, reports, and schedule-change
          alerts). Who receives each email type is controlled per-user on the Users tab.
        </p>
        <EmailSettings />
      </div>
    </div>
  );
}
