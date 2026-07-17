import { CompanyInfo } from './CompanyInfo';

export const dynamic = 'force-dynamic';

export default function CompanySettingsPage() {
  return (
    <div className="max-w-2xl">
      <div className="card p-6">
        <h2 className="brand-heading mb-1 text-sm text-brand-gray">Company Info</h2>
        <p className="mb-5 text-sm text-brand-gray">
          The company name, address, and contact details shown on customer-facing quote PDFs.
          Changes apply to quotes generated after saving.
        </p>
        <CompanyInfo />
      </div>
    </div>
  );
}
