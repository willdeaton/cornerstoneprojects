import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getQuoteWithItems } from '@/lib/data';
import { getCompanyInfo } from '@/lib/company';
import { PrintToolbar } from './PrintButton';
import { QuoteDocument } from './QuoteDocument';

export const dynamic = 'force-dynamic';

export default async function QuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) notFound();
  const quote = await getQuoteWithItems(numId);
  if (!quote) notFound();

  const company = await getCompanyInfo();

  // Filename for the downloaded PDF — prefer the quote number, fall back to the id.
  const pdfFileName = `Quote-${quote.quote_number || quote.id}`;

  return (
    <div className="min-h-screen bg-neutral-100">
      <PrintToolbar editHref={`/quotes/${quote.id}/edit`} fileName={pdfFileName} />
      <QuoteDocument quote={quote} company={company} />
    </div>
  );
}
