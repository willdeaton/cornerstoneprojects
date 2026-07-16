import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { activeEntry } from '@/lib/data';
import { AppShell } from './AppShell';

export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const active = activeEntry(user.id);

  return (
    <AppShell
      user={{ name: user.name, email: user.email, role: user.role }}
      clockedInTo={active ? { project: active.project_name, customer: active.customer } : null}
    >
      {children}
    </AppShell>
  );
}
