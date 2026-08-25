'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { money } from '@/lib/format';
import { contractLocked, contractRevised, CONTRACT_LOCK_REASON } from '@/lib/billing';
import {
  changeContractValueAction,
  getContractValueContextAction,
  type ContractValueContext,
} from '@/app/actions/billing';
import { ContractValueHistory } from './ContractValueHistory';

/**
 * Change what a sold job is worth — a change order, not an edit.
 *
 * The contract value used to be a text box on the Edit Project form, which meant
 * a job could be worth five thousand more than yesterday with nothing anywhere
 * saying why. So the reason is required, the way a schedule change's is: "the
 * value changed" is unreadable a fortnight later, and "added roof curb flashing
 * per the owner's walkthrough" tells the next person what they are looking at.
 *
 * Its figures are fetched when it opens rather than handed down, because what is
 * invoiced and what is left to bill are the numbers this decision turns on and
 * they have to be the ones true now. Nothing here is a gate —
 * `changeContractValueAction` re-checks every rule against the rows as they are.
 */
export function ContractValueControl({
  projectId,
  projectName,
  open: controlledOpen,
  onClose,
  onChanged,
  locked,
}: {
  projectId: number;
  projectName: string;
  /** Given together with `onClose`, the caller owns the open state and no
   *  trigger is rendered — the Edit Project form drives it that way. */
  open?: boolean;
  onClose?: () => void;
  /** Let a caller holding its own copy of the job reload it — the billing desk
   *  keeps its rows in state, so a refresh alone wouldn't move them. */
  onChanged?: () => void;
  /** Label the trigger honestly on a settled job. Only the label: the dialog
   *  re-derives the stage and the action enforces it either way. */
  locked?: boolean;
}) {
  const router = useRouter();
  const controlled = controlledOpen !== undefined;
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlled ? controlledOpen : ownOpen;

  const [ctx, setCtx] = useState<ContractValueContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [coNumber, setCoNumber] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * `fresh` opens the dialog from nothing; a reload after a refusal keeps what
   * was typed — being told the figure moved under you is not a reason to lose
   * the reason you had already written for it.
   */
  const load = useCallback(
    async (fresh: boolean) => {
      setCtx(null);
      setLoadError(null);
      if (fresh) {
        setError(null);
        setCoNumber('');
        setReason('');
        setValue('');
      }
      const next = await getContractValueContextAction(projectId);
      if (!next) {
        setLoadError('That job no longer exists.');
        return;
      }
      setCtx(next);
      if (fresh) setValue(String(next.current));
    },
    [projectId]
  );

  // Fetched on open, whoever owns the open state — the Edit Project form drives
  // this one controlled, so a trigger-side load would leave it loading forever.
  useEffect(() => {
    if (open) void load(true);
  }, [open, load]);

  function close() {
    if (controlled) onClose?.();
    else setOwnOpen(false);
  }

  async function save() {
    setError(null);
    setBusy(true);
    const res = await changeContractValueAction(projectId, {
      value,
      co_number: coNumber,
      reason,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not save that.');
      // The value it was refused against may be stale; show what is true now.
      await load(false);
      return;
    }
    close();
    onChanged?.();
    router.refresh();
  }

  // Decided from what was just fetched, not from the `locked` prop — that is
  // only a label hint for the trigger, and may be a render behind.
  const settled = ctx ? contractLocked(ctx.summary.stage) : false;
  // Reasoned about as typed, so the impact line moves with the number.
  const typed = parseFloat(value.replace(/[$,\s]/g, ''));
  const next = Number.isFinite(typed) ? typed : null;
  const s = ctx?.summary;

  return (
    <>
      {!controlled && (
        <button
          className="text-xs font-medium text-brand-gray hover:text-brand-ink hover:underline"
          onClick={() => setOwnOpen(true)}
          title={
            locked
              ? "This job's billing has settled — see why the value can't move"
              : 'Record a change to what this job is worth, with the reason for it'
          }
        >
          {locked ? 'Contract value locked' : '+ Change contract value'}
        </button>
      )}

      <Modal open={open} onClose={close} title="Change Contract Value">
        <div className="space-y-4">
          <p className="text-sm text-brand-gray">{projectName}</p>

          {loadError && <p className="text-sm text-red-600">{loadError}</p>}
          {!ctx && !loadError && <p className="text-sm text-brand-gray">Loading the numbers…</p>}

          {ctx && contractLocked(ctx.summary.stage) && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {CONTRACT_LOCK_REASON[ctx.summary.stage]}
            </p>
          )}

          {ctx && (
            <div className="rounded-lg bg-surface-sunken px-3 py-2 text-sm">
              <span className="text-brand-gray">Currently worth </span>
              <strong className="tnum text-brand-ink">
                {money(ctx.current, { cents: true })}
              </strong>
              {contractRevised(ctx.current, ctx.soldAt) && (
                <span className="text-brand-gray">
                  {' · sold at '}
                  <span className="tnum">{money(ctx.soldAt, { cents: true })}</span>
                </span>
              )}
            </div>
          )}

          {ctx && !settled && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">New Contract Value</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="label">Change Order #</label>
                  <input
                    className="input"
                    value={coNumber}
                    onChange={(e) => setCoNumber(e.target.value)}
                    placeholder="e.g. CO-003 — optional"
                  />
                </div>
              </div>

              <div>
                <label className="label">Why It&apos;s Changing</label>
                <textarea
                  className="input min-h-[72px]"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Added roof curb flashing per the owner's walkthrough"
                />
                <p className="mt-1 text-xs text-brand-gray">
                  Required. This is what the billing desk reads when a job is invoiced over its
                  contract.
                </p>
              </div>

              {s && next != null && (
                <div className="space-y-1.5 rounded-lg bg-surface-sunken px-3 py-2 text-sm">
                  <p className="text-brand-gray">
                    <span className="tnum">{money(s.billed, { cents: true })}</span> has gone out to
                    the customer ·{' '}
                    <strong className="tnum text-brand-ink">
                      {money(Math.max(0, next - s.billed), { cents: true })}
                    </strong>{' '}
                    would be left to bill
                  </p>
                  {next < s.billed && (
                    <p className="text-amber-700">
                      That leaves the job invoiced{' '}
                      <span className="tnum">{money(s.billed - next, { cents: true })}</span> over
                      its contract — a credit invoice squares it.
                    </p>
                  )}
                  {next > s.invoiced && s.count > 0 && (
                    <p className="text-amber-700">
                      <span className="tnum">{money(next - s.invoiced, { cents: true })}</span> of
                      the new value has no invoice against it yet.
                    </p>
                  )}
                  {s.billedCount > 0 &&
                    Math.round(s.invoiced * 100) === Math.round(ctx.current * 100) && (
                      <p className="text-brand-gray">
                        The invoicing on this job was raised for the current contract value and has
                        already gone out — this change doesn&apos;t touch it. Raise a supplemental
                        invoice (or a credit) for the difference in the ledger.
                      </p>
                    )}
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn-secondary" onClick={close} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={save}
                  disabled={busy || reason.trim() === '' || next == null}
                  title={
                    reason.trim() === ''
                      ? 'Say why the contract value is changing'
                      : next == null
                        ? 'Enter the new contract value'
                        : undefined
                  }
                >
                  {busy ? 'Saving…' : 'Record Change'}
                </button>
              </div>
            </>
          )}

          {ctx && (
            <div className="border-t border-surface-line pt-3">
              <h3 className="brand-heading mb-1 text-xs text-brand-gray">History</h3>
              <ContractValueHistory changes={ctx.changes} />
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
