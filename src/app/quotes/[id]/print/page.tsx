import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getQuoteWithItems, quoteTotals, lineAmount } from '@/lib/data';
import { money, shortDate } from '@/lib/format';
import { getCompanyInfo } from '@/lib/company';
import { PrintToolbar } from './PrintButton';

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

  // Only customer-facing ('display') line items are printed; the pricing
  // worksheet stays internal. A pipeline-only quote (imported / quick-added,
  // no display items) has nothing to sum, so fall back to its stored bid_value
  // instead of printing $0.
  const displayItems = quote.line_items.filter((li) => li.kind !== 'pricing');
  const hasItems = displayItems.length > 0;
  const computed = quoteTotals(quote.line_items, quote.tax_rate);
  const subtotal = hasItems ? computed.subtotal : quote.bid_value;
  const tax = hasItems ? computed.tax : 0;
  const total = hasItems ? computed.total : quote.bid_value;
  const taxPct = +(quote.tax_rate * 100).toFixed(4);

  return (
    <div className="min-h-screen bg-neutral-100">
      <PrintToolbar editHref={`/quotes/${quote.id}/edit`} />

      <div className="mx-auto my-6 max-w-[8.5in] bg-white p-[0.6in] shadow-card print:my-0 print:max-w-none print:p-0 print:shadow-none">
        {/* Header */}
        <div className="flex items-start justify-between gap-6 border-b-2 border-brand-green pb-5">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={company.logo} alt={company.name} className="mb-3 h-14 w-auto max-w-[220px] object-contain" />
            <p className="text-sm font-semibold text-brand-ink">{company.name}</p>
            {company.addressLines.map((l) => (
              <p key={l} className="text-xs text-brand-gray">{l}</p>
            ))}
            <p className="text-xs text-brand-gray">
              {[company.phone, company.email, company.website].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="text-right">
            <h1 className="brand-heading text-3xl text-brand-ink">Quote</h1>
            {quote.quote_number && (
              <p className="mt-1 text-sm text-brand-gray">
                No. <span className="font-semibold text-brand-ink">{quote.quote_number}</span>
              </p>
            )}
            <p className="mt-2 text-xs text-brand-gray">
              Issued <span className="font-medium text-brand-ink">{shortDate(quote.issue_date)}</span>
            </p>
            {quote.valid_until && (
              <p className="text-xs text-brand-gray">
                Valid until <span className="font-medium text-brand-ink">{shortDate(quote.valid_until)}</span>
              </p>
            )}
          </div>
        </div>

        {/* Bill-to / project */}
        <div className="mt-6 grid grid-cols-2 gap-8 text-sm">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-gray">Prepared For</p>
            <p className="font-semibold text-brand-ink">{quote.customer}</p>
            {quote.customer_contact && <p className="text-brand-gray">{quote.customer_contact}</p>}
            {quote.customer_address && (
              <p className="whitespace-pre-line text-brand-gray">{quote.customer_address}</p>
            )}
            {quote.customer_phone && <p className="text-brand-gray">{quote.customer_phone}</p>}
            {quote.customer_email && <p className="text-brand-gray">{quote.customer_email}</p>}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-gray">Project</p>
            {quote.project_name && <p className="font-semibold text-brand-ink">{quote.project_name}</p>}
            {quote.project_location && <p className="text-brand-gray">{quote.project_location}</p>}
            {quote.category && <p className="text-brand-gray">{quote.category}</p>}
            {quote.prepared_by && (
              <p className="mt-2 text-xs text-brand-gray">Prepared by {quote.prepared_by}</p>
            )}
          </div>
        </div>

        {/* Line items */}
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b-2 border-black/10 text-left text-xs uppercase tracking-wide text-brand-gray">
              <th className="py-2 pr-2 font-semibold">Description</th>
              <th className="py-2 pl-2 text-right font-semibold">Price</th>
            </tr>
          </thead>
          <tbody>
            {!hasItems ? (
              <tr className="border-b border-black/5 align-top">
                <td className="py-2 pr-2 text-brand-ink whitespace-pre-line">
                  {quote.project_name || quote.customer}
                </td>
                <td className="py-2 pl-2 text-right font-semibold text-brand-ink whitespace-nowrap">{money(quote.bid_value, { cents: true })}</td>
              </tr>
            ) : (
              displayItems.map((li) => (
                <tr key={li.id} className="border-b border-black/5 align-top">
                  <td className="py-2 pr-2 text-brand-ink whitespace-pre-line">{li.description}</td>
                  <td className="py-2 pl-2 text-right font-semibold text-brand-ink whitespace-nowrap">
                    {money(lineAmount(li), { cents: true })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-brand-gray">Subtotal</span>
              <span className="font-semibold text-brand-ink">{money(subtotal, { cents: true })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-brand-gray">Tax{taxPct ? ` (${taxPct}%)` : ''}</span>
              <span className="font-semibold text-brand-ink">{money(tax, { cents: true })}</span>
            </div>
            <div className="flex justify-between border-t-2 border-brand-green pt-2 text-base">
              <span className="font-semibold text-brand-ink">Total</span>
              <span className="font-bold text-brand-ink">{money(total, { cents: true })}</span>
            </div>
          </div>
        </div>

        {/* Terms & notes */}
        {(quote.terms || quote.notes) && (
          <div className="mt-8 grid grid-cols-1 gap-6 border-t border-black/10 pt-5 text-sm sm:grid-cols-2">
            {quote.terms && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-gray">Terms &amp; Conditions</p>
                <p className="whitespace-pre-line text-brand-gray">{quote.terms}</p>
              </div>
            )}
            {quote.notes && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-gray">Notes</p>
                <p className="whitespace-pre-line text-brand-gray">{quote.notes}</p>
              </div>
            )}
          </div>
        )}

        <p className="mt-10 text-center text-xs text-brand-gray">
          Thank you for the opportunity to earn your business. — {company.name}
        </p>
      </div>
    </div>
  );
}
