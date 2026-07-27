import type { QuoteWithItems, QuoteLineItem } from '@/lib/types';
import type { CompanyInfo } from '@/lib/company';
import { money, shortDate } from '@/lib/format';
import { sanitizeRichText, richTextToPlain } from '@/lib/richtext';
import { blockTotals, groupQuoteLines, shownAmount } from '@/lib/quote-math';

/**
 * The customer-facing quote document. Pure and dependency-free (no hooks, no
 * server-only imports) so it renders identically on the server print page and
 * when the Backup panel converts many quotes to PDF client-side via
 * `renderToStaticMarkup`.
 */

/** One pricing option as printed: its name, its lines, and its own total. */
interface PrintedOption {
  name: string;
  rows: QuoteLineItem[];
  shownAmounts: number[];
  total: number;
  /**
   * True when the option is one line whose text is already the option name — the
   * shape every option had before options could hold line items. It prints as a
   * single name/price row rather than a heading + row + total block.
   */
  bare: boolean;
}

/**
 * Subtotal / total exactly as printed. Markup is per line and folded into each
 * line price (no separate markup row), and each shown amount is rounded to cents
 * so the printed total equals the sum of the printed line prices. There is no
 * tax. A quote with no base line items falls back to its stored bid_value.
 *
 * Pricing options are grouped by `option_group` and totalled one at a time —
 * never summed together, and never added into the base Total.
 */
export function computeQuoteView(quote: QuoteWithItems) {
  const { base: displayItems, groups } = groupQuoteLines(quote.line_items);
  const hasItems = displayItems.length > 0;
  const shownAmounts = displayItems.map(shownAmount);
  const total = hasItems ? shownAmounts.reduce((s, a) => s + a, 0) : quote.bid_value;
  const optionGroups: PrintedOption[] = groups.map((g) => {
    const firstText = richTextToPlain(g.rows[0]?.description).trim();
    // A legacy single-line option carries its name in the line's own text.
    const name = g.name || firstText;
    return {
      name,
      rows: g.rows,
      shownAmounts: g.rows.map(shownAmount),
      total: blockTotals(g.rows).total,
      bare: g.rows.length === 1 && firstText === name.trim(),
    };
  });
  return { displayItems, optionGroups, hasItems, shownAmounts, total };
}

export function QuoteDocument({
  quote,
  company,
}: {
  quote: QuoteWithItems;
  company: CompanyInfo;
}) {
  const { displayItems, optionGroups, hasItems, shownAmounts, total } = computeQuoteView(quote);

  return (
    <div
      id="quote-document"
      className="mx-auto my-6 max-w-[8.5in] bg-white p-[0.6in] shadow-card print:my-0 print:max-w-none print:p-0 print:shadow-none"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-6 border-b-2 border-brand-green pb-5">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={company.logo} alt={company.name} className="mb-3 h-14 w-auto max-w-[220px] object-contain" />
          <p className="text-sm font-semibold text-brand-ink">{company.name}</p>
          {company.addressLines.map((l) => (
            <p key={l} className="text-xs text-brand-gray">{l}</p>
          ))}
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
          {/* Company phone / email / website, stacked one per line. */}
          {(company.phone || company.email || company.website) && (
            <div className="mt-3 text-xs text-brand-gray">
              {company.phone && <p>{company.phone}</p>}
              {company.email && <p>{company.email}</p>}
              {company.website && <p>{company.website}</p>}
            </div>
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

      {/* Line items + Total. Skipped when the quote is options-only (the
          Pricing Options block below carries the prices instead). */}
      {(hasItems || optionGroups.length === 0) && (
        <>
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
                displayItems.map((li, idx) => (
                  <tr key={li.id} className="border-b border-black/5 align-top">
                    <td
                      className="rich-text py-2 pr-2 text-brand-ink"
                      dangerouslySetInnerHTML={{ __html: sanitizeRichText(li.description) }}
                    />
                    <td className="py-2 pl-2 text-right font-semibold text-brand-ink whitespace-nowrap">
                      {money(shownAmounts[idx], { cents: true })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Totals — markup is folded into each line price, so no separate rows. */}
          <div className="mt-4 flex justify-end">
            <div className="w-64 space-y-1.5 text-sm">
              <div className="flex justify-between border-t-2 border-brand-green pt-2 text-base">
                <span className="font-semibold text-brand-ink">Total</span>
                <span className="font-bold text-brand-ink">{money(total, { cents: true })}</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Pricing options — priced alternatives the customer picks between. Each
          is totalled on its own and never added into the base Total. */}
      {optionGroups.length > 0 && (
        <div className="mt-6">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-gray">
            Pricing Options{optionGroups.length > 1 ? ' — select one' : ''}
          </p>
          {/* A one-line option prints as a single name/price row — the same as it
              always has. An option built from several lines prints as its own
              block: name, its lines, then that option's total. */}
          {optionGroups.every((g) => g.bare) ? (
            <table className="w-full text-sm">
              <tbody>
                {optionGroups.map((g) => (
                  <tr key={g.rows[0].id} className="border-b border-black/5 align-top">
                    <td
                      className="rich-text py-2 pr-2 text-brand-ink"
                      dangerouslySetInnerHTML={{ __html: sanitizeRichText(g.rows[0].description) }}
                    />
                    <td className="py-2 pl-2 text-right font-semibold text-brand-ink whitespace-nowrap">
                      {money(g.shownAmounts[0], { cents: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            optionGroups.map((g) =>
              g.bare ? (
                <div
                  key={g.rows[0].id}
                  className="mt-2 flex justify-between border-b border-black/5 py-2 text-sm"
                >
                  <span className="text-brand-ink">{g.name}</span>
                  <span className="font-semibold text-brand-ink whitespace-nowrap">
                    {money(g.shownAmounts[0], { cents: true })}
                  </span>
                </div>
              ) : (
                <div key={g.rows[0].id} className="mt-4 break-inside-avoid first:mt-2">
                  <p className="border-b border-black/10 pb-1 text-sm font-semibold text-brand-ink">
                    {g.name}
                  </p>
                  <table className="w-full text-sm">
                    <tbody>
                      {g.rows.map((li, idx) => (
                        <tr key={li.id} className="border-b border-black/5 align-top">
                          <td
                            className="rich-text py-2 pr-2 text-brand-ink"
                            dangerouslySetInnerHTML={{ __html: sanitizeRichText(li.description) }}
                          />
                          <td className="py-2 pl-2 text-right font-semibold text-brand-ink whitespace-nowrap">
                            {money(g.shownAmounts[idx], { cents: true })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-2 flex justify-end">
                    <div className="flex w-64 justify-between border-t border-brand-green pt-1.5 text-sm">
                      <span className="font-semibold text-brand-ink">{g.name} Total</span>
                      <span className="font-bold text-brand-ink">
                        {money(g.total, { cents: true })}
                      </span>
                    </div>
                  </div>
                </div>
              )
            )
          )}
        </div>
      )}

      {/* Notes */}
      {quote.notes && (
        <div className="mt-8 border-t border-black/10 pt-5 text-sm">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-gray">Notes</p>
          <p className="whitespace-pre-line text-brand-gray">{quote.notes}</p>
        </div>
      )}

      {/* Acceptance — signature block the customer fills in to accept the quote */}
      <div className="mt-8 break-inside-avoid border-t border-black/10 pt-5 text-sm text-brand-ink">
        <p className="mb-5 font-semibold">Accepted By:</p>
        <div className="grid grid-cols-2 gap-x-12 gap-y-8">
          <div className="flex items-end gap-2">
            <span className="whitespace-nowrap">Name:</span>
            <span className="flex-1 border-b border-brand-ink" />
          </div>
          <div className="flex items-end gap-2">
            <span className="whitespace-nowrap">Date:</span>
            <span className="flex-1 border-b border-brand-ink" />
          </div>
          <div className="flex items-end gap-2">
            <span className="whitespace-nowrap">Signature:</span>
            <span className="flex-1 border-b border-brand-ink" />
          </div>
          <div className="flex items-end gap-2">
            <span className="whitespace-nowrap">PO Number:</span>
            <span className="flex-1 border-b border-brand-ink" />
          </div>
        </div>
      </div>

      <p className="mt-10 text-center text-xs text-brand-gray">
        Thank you for the opportunity to earn your business. — {company.name}
      </p>

      {/* Terms & Conditions — footer at the bottom in smaller italics */}
      {quote.terms && (
        <div className="mt-10 border-t border-black/10 pt-4">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-brand-gray">Terms &amp; Conditions</p>
          <p className="whitespace-pre-line text-[10px] italic leading-snug text-brand-gray">{quote.terms}</p>
        </div>
      )}
    </div>
  );
}
