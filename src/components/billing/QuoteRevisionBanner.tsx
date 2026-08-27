'use client';

import { useState } from 'react';
import { money } from '@/lib/format';
import type { QuoteSyncState } from '@/lib/quote-sync';
import { QuoteRevisionDialog } from '@/components/quotes/QuoteRevisionDialog';

/**
 * "This job's quote has been revised since it was sold."
 *
 * A revision can be left pending — the save that raised it offers a "decide
 * later", the biller may not be the person who edited the quote, and a settled
 * billing can refuse the price outright. None of those are reasons for the job
 * to go on quietly quoting the old number, so the drift is stated on the job
 * itself until somebody answers it.
 *
 * It states the money plainly rather than hiding it behind the dialog: a
 * billing variance that is about to move is the thing a biller most needs to
 * see before they raise an invoice against it.
 */
export function QuoteRevisionBanner({ state }: { state: QuoteSyncState }) {
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState(false);
  if (resolved) return null;

  const value = state.diff.value;
  const detail = state.diff.fields.length;

  return (
    <>
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              Quote{state.quoteNumber ? ` ${state.quoteNumber}` : ''} was revised after this job was
              sold
            </p>
            <p className="tnum mt-1 text-sm text-amber-800">
              {value ? (
                <>
                  Contract value {money(value.current, { cents: true })} →{' '}
                  <strong>{money(value.proposed, { cents: true })}</strong> if applied (
                  {value.delta > 0 ? '+' : '−'}
                  {money(Math.abs(value.delta), { cents: true })})
                  {detail > 0 &&
                    ` · ${detail} job detail${detail === 1 ? '' : 's'} changed`}
                </>
              ) : (
                <>
                  {detail} job detail{detail === 1 ? '' : 's'} changed on the quote. The contract
                  value is unaffected.
                </>
              )}
            </p>
            {state.locked && (
              <p className="mt-1 text-xs text-amber-800">{state.lockReason}</p>
            )}
          </div>
          <button className="btn-primary shrink-0" onClick={() => setOpen(true)}>
            Review
          </button>
        </div>
      </div>

      <QuoteRevisionDialog
        state={state}
        open={open}
        onClose={() => setOpen(false)}
        onResolved={() => {
          setOpen(false);
          setResolved(true);
        }}
      />
    </>
  );
}
