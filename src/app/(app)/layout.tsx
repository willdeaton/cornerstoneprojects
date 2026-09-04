import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { activeEntry } from '@/lib/data';
import { getBranding } from '@/lib/branding-store';
import { AppShell } from './AppShell';
import { BackupReminder } from './BackupReminder';

export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [active, branding] = await Promise.all([activeEntry(user.id), getBranding()]);

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        realRole: user.realRole ?? user.role,
        viewingAs: user.viewingAs ?? null,
      }}
      clockedInTo={
        active
          ? {
              project: active.project_name ?? 'General (no job)',
              customer: active.customer ?? '',
            }
          : null
      }
      logoSrc={branding.full}
      iconSrc={branding.icon}
    >
      {children}
      <BackupReminder isAdmin={(user.realRole ?? user.role) === 'admin'} />
    </AppShell>
  );
}
