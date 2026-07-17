import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { SettingsTabs } from './SettingsTabs';

export const dynamic = 'force-dynamic';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/dashboard');

  return (
    <div>
      <PageHeader title="Settings" subtitle="App configuration, company info, and users" />
      <SettingsTabs />
      {children}
    </div>
  );
}
