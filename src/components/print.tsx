'use client';

import { useEffect, useState } from 'react';

/**
 * Printing a list view.
 *
 * The lists (Projects, Billing) are already the report somebody wants on paper
 * — the filters, the sort and the columns are the report's definition. So print
 * is the browser's own print, on the view as it stands, rather than a separate
 * document route to keep in step with the table: what is on screen is what
 * comes out, and a filtered, sorted list prints filtered and sorted.
 *
 * The `@media print` rules in globals.css do the work of turning the screen
 * into a sheet — app chrome and controls out, the horizontal scroller undone,
 * table headers repeated across pages. These two components are the parts that
 * have to live in the tree: the control that starts a print, and the line of
 * context that only a printout needs.
 */

export function PrintButton({
  label = 'Print',
  title = 'Print this list',
  className = 'btn-secondary',
}: {
  label?: string;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      // Never itself on the page it prints.
      className={`no-print ${className}`}
      title={title}
      onClick={() => window.print()}
    >
      <PrinterIcon />
      {label}
    </button>
  );
}

/**
 * The line a printout needs and the screen doesn't: which slice of the list
 * this is, and when it was run. The page's own header already carries the
 * title, so this doesn't repeat it — what print drops is the tab strip, the
 * search box and the filters, and this is those said in words, next to the
 * timestamp that tells somebody holding the sheet how old it is.
 *
 * The timestamp is filled in after mount rather than at render: it isn't a
 * property of the data, and rendering "now" on the server would only guarantee
 * a hydration mismatch.
 */
export function PrintMeta({
  /** Bits of context, joined with dots. Falsy entries drop out, so a caller can
   *  list every possible one and let the conditions decide. */
  meta,
}: {
  meta?: (string | false | null | undefined)[];
}) {
  const [printedAt, setPrintedAt] = useState('');

  useEffect(() => {
    const stamp = () =>
      setPrintedAt(
        new Date().toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      );
    stamp();
    // Re-stamped on the way to the printer, so a tab left open overnight
    // doesn't print yesterday's time.
    window.addEventListener('beforeprint', stamp);
    return () => window.removeEventListener('beforeprint', stamp);
  }, []);

  const lines = (meta ?? []).filter((m): m is string => Boolean(m));

  return (
    <div className="print-only mb-2 mt-4 flex items-baseline justify-between gap-4 border-b border-black/20 pb-1.5">
      <p className="tnum text-[9pt] font-semibold text-brand-ink">{lines.join(' · ')}</p>
      {printedAt && (
        <p className="whitespace-nowrap text-[9pt] text-brand-gray">Printed {printedAt}</p>
      )}
    </div>
  );
}

/** The app's printer glyph. Exported so anything that offers a print — the
 *  list-view button here, the per-employee timesheet link on Timesheets — shows
 *  the same mark. */
export function PrinterIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v8H6z" />
    </svg>
  );
}
