import { getCurrentUser } from '@/lib/auth';
import { EmailSettings } from '../EmailSettings';
import { SendApprovalEmails } from './SendApprovalEmails';

export const dynamic = 'force-dynamic';

export default async function EmailSettingsPage() {
  const me = await getCurrentUser();

  return (
    <div className="max-w-2xl space-y-6">
      <div className="card p-6">
        <h2 className="brand-heading mb-1 text-sm text-brand-gray">Email Settings</h2>
        <p className="mb-5 text-sm text-brand-gray">
          Sender identity for automated notifications (new-project and job-completion
          emails). Who receives each email type is controlled per-user on the Users tab.
        </p>
        <EmailSettings />
      </div>

      {me?.role === 'admin' && (
        <div className="card p-6">
          <h2 className="brand-heading mb-1 text-sm text-brand-gray">Weekly Time Approval</h2>
          <p className="mb-5 text-sm text-brand-gray">
            Every Monday morning each manager automatically gets an email summarizing their
            direct reports&apos; hours from the prior week, with a link to approve them without
            logging in. Use this button to send those emails again right now (for the prior
            week) — for example if a manager missed or deleted theirs.
          </p>
          <SendApprovalEmails />
        </div>
      )}
    </div>
  );
}
