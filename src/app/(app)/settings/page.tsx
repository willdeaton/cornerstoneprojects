import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getLogo } from '@/lib/data';
import { PageHeader } from '@/components/ui';
import { LogoUpload } from './LogoUpload';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/dashboard');

  const logo = await getLogo();

  return (
    <div>
      <PageHeader title="Settings" subtitle="Company branding and app configuration" />

      <div className="max-w-2xl">
        <div className="card p-6">
          <h2 className="brand-heading mb-1 text-sm text-brand-gray">Company Logo</h2>
          <p className="mb-5 text-sm text-brand-gray">
            Upload your logo to replace the default across the sign-in screen and the sidebar. A
            PNG or SVG with a transparent background and light-colored artwork looks best on the
            dark sidebar. Max 1&nbsp;MB.
          </p>
          <LogoUpload currentLogo={logo} hasCustom={!!logo} />
        </div>
      </div>
    </div>
  );
}
