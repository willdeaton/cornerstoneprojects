import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getBranding } from '@/lib/branding-store';
import { CompanyInfo } from './CompanyInfo';
import { LogoSettings } from './LogoSettings';
import { QuoteDefaults } from './QuoteDefaults';

export const dynamic = 'force-dynamic';

export default async function CompanySettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') redirect('/dashboard');

  const branding = await getBranding();
  return (
    <div className="max-w-2xl space-y-6">
      <div className="card p-6">
        <h2 className="brand-heading mb-1 text-sm text-brand-gray">Company Info</h2>
        <p className="mb-5 text-sm text-brand-gray">
          The company name, address, and contact details shown on customer-facing quote PDFs.
          Changes apply to quotes generated after saving.
        </p>
        <CompanyInfo />
      </div>

      <div className="card p-6">
        <h2 className="brand-heading mb-1 text-sm text-brand-gray">Quote Terms &amp; Conditions</h2>
        <p className="mb-5 text-sm text-brand-gray">
          The default Terms &amp; Conditions added to every new quote. Set them once here so they
          appear on each quote PDF without retyping.
        </p>
        <QuoteDefaults />
      </div>

      <div className="card p-6">
        <h2 className="brand-heading mb-1 text-sm text-brand-gray">Logos</h2>
        <p className="mb-5 text-sm text-brand-gray">
          Upload the logos used across the app and on estimate PDFs.
        </p>
        <LogoSettings branding={branding} />
      </div>
    </div>
  );
}
