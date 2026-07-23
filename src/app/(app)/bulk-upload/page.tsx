/**
 * Temporary Bulk Upload tool (admin only).
 *
 * A one-quote-at-a-time importer: drop a quote PDF (its text pre-fills the
 * header), optionally its pricing Excel (parsed into line items), attach every
 * file to the quote, and save — creating a new quote or updating an existing
 * one. Built to be removed after the initial data load: delete this folder,
 * delete `src/app/api/bulk-upload/`, and remove the one nav entry in AppShell.
 */
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listQuotes } from '@/lib/data';
import { PageHeader } from '@/components/ui';
import { BulkUpload, type ExistingQuote } from './BulkUpload';

export const dynamic = 'force-dynamic';

export default async function BulkUploadPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') redirect('/dashboard');

  const quotes = await listQuotes();
  const existing: ExistingQuote[] = quotes.map((q) => ({
    id: q.id,
    quote_number: q.quote_number,
    customer: q.customer,
    project_name: q.project_name,
  }));

  return (
    <div>
      <PageHeader
        title="Bulk Upload"
        subtitle="Import quotes from PDFs and Excel files — one quote at a time. Temporary tool for the initial data load."
      />
      <BulkUpload existing={existing} />
    </div>
  );
}
