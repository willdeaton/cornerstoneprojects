'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { money } from '@/lib/format';
import type { QuoteSyncFieldKey, QuoteSyncState } from '@/lib/quote-sync';
import {
  applyQuoteRevisionAction,
  dismissQuoteRevisionAction,
  quoteSyncStateAction,
} from '@/app/actions/quote-sync';

/**
 * Push a revised sold quote through to its job — the one screen where the two
 * halves of the app are shown disagreeing.
 *
 * It opens on a save that revised an already-sold quote, and from the banner on
 * a job that has a revision waiting. What it asks for is a reason, for the same
 * reason the change-order dialog does: "the quote changed" is unreadable a
 * fortnight later, and "added roof curb flashing per the owner's walkthrough"
 * tells the next person what they are looking at. The entry it writes lands in
 * the job's existing Contract Value History, badged as having come from a
 * quote, so there is one place to follow rather than two.
 *
 * The price applies as a DELTA (see `quoteSyncDiff`): a job whose value has
 * already been moved by a change order keeps that change order and takes the
 * revision on top of it. The dialog says so in as many words, because a biller
 * looking at a number that isn't the quote's own total deserves to know why.
 *
 * Nothing here is a gate. Every rule — the billing lock, the role, the figures
 * themselves — is enforced again in `applyQuoteRevisionAction` against the rows
 * as they are when Apply is pressed.
 */
export function QuoteRevisionDialog({
  state: initial,
  open,
  onClose,
  onResolved,
}: {
  /** The revision to answer, as the server last described it. */
  state: QuoteSyncState;
  open: boolean;
  /** Leave it pending — the banner on the job keeps offering it. */
  onClose: () => void;
  /** Applied or dismissed: there is nothing left to answer. */
  onResolved?: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<QuoteSyncState>(initial);
  const [checked, setChecked] = useState<Set<QuoteSyncFieldKey>>(new Set());
  const [applyValue, setApplyValue] = useState(true);
  const [coNumber, setCoNumber] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Everything that drifted starts ticked: the common case is a revision the
   * user has just made deliberately and wants carried through, and making them
   * tick their own edits back on would be asking the same question twice.
   */
  const seed = useCallback((s: QuoteSyncState) => {
    setChecked(new Set(s.diff.fields.map((f) => f.key)));
    setApplyValue(!!s.diff.value && !s.locked && s.canChangeValue);
  }, []);

  useEffect(() => {
    if (open) {
      setState(initial);
      seed(initial);
      setError(null);
    }
  }, [open, initial, seed]);

  /** After a refusal, show what is true now — without losing what was typed. */
  async function reload() {
    const next = await quoteSyncStateAction(state.quoteId);
    if (!next) {
      onResolved?.();
      router.refresh();
      return;
    }
    setState(next);
    seed(next);
  }

  function toggle(key: QuoteSyncFieldKey) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const value = state.diff.value;
  const valueBlocked = !!value && (state.locked || !state.canChangeValue);
  const movingValue = !!value && applyValue && !valueBlocked;
  const nothingPicked = checked.size === 0 && !movingValue;

  async function apply() {
    setError(null);
    setBusy(true);
    const res = await applyQuoteRevisionAction(state.quoteId, {
      fields: [...checked],
      applyValue: movingValue,
      co_number: coNumber,
      reason,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not apply that.');
      await reload();
      return;
    }
    onResolved?.();
    router.refresh();
  }

  async function dismiss() {
    setError(null);
    setBusy(true);
    const res = await dismissQuoteRevisionAction(state.quoteId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not dismiss that.');
      await reload();
      return;
    }
    onResolved?.();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="Quote revised after it was sold">
      <div className="space-y-5">
        <p className="text-sm text-brand-gray">
          {state.quoteNumber ? (
            <>
              Quote <strong className="text-brand-ink">{state.quoteNumber}</strong> was already sold
            </>
          ) : (
            'This quote was already sold'
          )}{' '}
          — it became{' '}
          <strong className="text-brand-ink">{state.projectName}</strong>. Choose what to carry
          across to the job.
        </p>

        {value && (
          <div className="rounded-lg border border-black/10 p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={movingValue}
                disabled={valueBlocked || busy}
                onChange={(e) => setApplyValue(e.target.checked)}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-brand-ink">Contract value</span>
                <span className="tnum mt-1 block text-sm text-brand-gray">
                  {money(value.current, { cents: true })} →{' '}
                  <strong className="text-brand-ink">
                    {money(value.proposed, { cents: true })}
                  </strong>{' '}
                  <span
                    className={`badge tnum ml-1 ${
                      value.delta > 0
                        ? 'bg-brand-green/15 text-brand-green-dark'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {value.delta > 0 ? '+' : '−'}
                    {money(Math.abs(value.delta), { cents: true })}
                  </span>
                </span>
                {/* Only worth explaining when the two figures differ — on a job
                    with no change orders they are the same number and saying so
                    would be noise. */}
                {Math.round(value.current * 100) !== Math.round(value.syncedAt * 100) && (
                  <span className="mt-1 block text-xs text-brand-gray">
                    The quote moved {money(Math.abs(value.delta), { cents: true })} (
                    {money(value.syncedAt, { cents: true })} →{' '}
                    {money(value.quoteValue, { cents: true })}), applied on top of the change
                    orders already recorded on this job.
                  </span>
                )}
              </span>
            </label>

            {state.locked && (
              <p className="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-800">
                {state.lockReason} The job&apos;s details below can still be updated, and this
                revision stays flagged on the job until it&apos;s applied or dismissed.
              </p>
            )}
            {!state.locked && !state.canChangeValue && (
              <p className="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-800">
                Only an admin or manager can move a contract value. Save the details now — the job
                keeps showing this revision until somebody with billing access applies the price.
              </p>
            )}

            {movingValue && (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="label" htmlFor="revision-co">
                    CO # <span className="font-normal text-brand-gray">(optional)</span>
                  </label>
                  <input
                    id="revision-co"
                    className="input"
                    value={coNumber}
                    disabled={busy}
                    placeholder="e.g. CO-2"
                    onChange={(e) => setCoNumber(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="revision-reason">
                    What changed on the quote?
                  </label>
                  <input
                    id="revision-reason"
                    className="input"
                    value={reason}
                    disabled={busy}
                    placeholder="e.g. added roof curb flashing per the owner's walkthrough"
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-brand-gray">
                    Recorded in this job&apos;s contract value history, with your name and the
                    quote number.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {state.diff.fields.length > 0 && (
          <div className="rounded-lg border border-black/10 p-4">
            <p className="mb-3 text-sm font-medium text-brand-ink">Job details</p>
            <ul className="space-y-3">
              {state.diff.fields.map((f) => (
                <li key={f.key}>
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked.has(f.key)}
                      disabled={busy}
                      onChange={() => toggle(f.key)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-brand-ink">{f.label}</span>
                      <span className="block break-words text-sm text-brand-gray">
                        {f.from ?? '—'} →{' '}
                        <strong className="text-brand-ink">{f.to ?? '—'}</strong>
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Leaves the revision pending: the job keeps flagging it, so a save
              made in a hurry is never the last word on it. */}
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Decide later
          </button>
          <button
            className="btn-ghost"
            onClick={dismiss}
            disabled={busy}
            title="Reconcile the job with the quote without changing what the job is worth"
          >
            Don&apos;t update the job
          </button>
          <button
            className="btn-primary"
            onClick={apply}
            disabled={busy || nothingPicked || (movingValue && !reason.trim())}
          >
            {busy ? 'Updating…' : 'Update job'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
