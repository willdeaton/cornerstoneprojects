'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Project } from '@/lib/types';
import { money, shortDate } from '@/lib/format';
import {
  hasPurchaseOrder,
  poRemaining,
  poOverrun,
  type BillingStage,
  type JobPurchaseOrder,
} from '@/lib/billing';
import { setPurchaseOrderAction } from '@/app/actions/billing';

/**
 * The customer's PO for the job — recorded before anything is billed, which is
 * the whole reason it lives here rather than on an invoice.
 *
 * A PO normally arrives with the award, weeks before the first invoice; the
 * number typed onto that invoice is a number somebody had to go and find, and
 * a job whose PO never got written down anywhere is a job that gets billed and
 * then bounced. So it is recorded against the job the day it lands, sits on the
 * billing card from then on, and fills in every invoice raised afterwards.
 *
 * A job billed across more than one PO still overrides it per invoice: the
 * invoice's own PO column is the truth for that invoice, and this is the
 * default it starts from.
 *
 * Edited in place rather than in a dialog — three fields off one piece of
 * paper, entered the same way the invoice ledger below is.
 */

/** What the card needs off the project row. */
export type PurchaseOrderProject = Pick<Project, 'id' | 'po_number' | 'po_amount' | 'po_date'>;

/** How a saved amount reads in the input: whole dollars bare, cents in full. */
function amountText(amount: number | null): string {
  if (amount == null) return '';
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export function PurchaseOrderCard({
  project,
  invoiced,
  stage,
  variant = 'card',
  onChanged,
}: {
  project: PurchaseOrderProject;
  /** Everything raised against the job, for what is left on the PO. */
  invoiced: number;
  /** Where the job's billing stands, so the nudge is phrased for it. */
  stage: BillingStage;
  /** `inline` drops the card chrome, for a panel already inside a card. */
  variant?: 'card' | 'inline';
  /** Called after a save lands, for a caller holding its own copy of the job. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [number, setNumber] = useState(project.po_number ?? '');
  const [amount, setAmount] = useState(amountText(project.po_amount));
  const [date, setDate] = useState(project.po_date ?? '');

  // The saved PO, as of the last render from the server. Kept in step while the
  // form is closed — the billing desk rewrites its rows under this card — and
  // left alone while somebody is typing into it.
  const saved: JobPurchaseOrder = {
    po_number: project.po_number,
    po_amount: project.po_amount,
    po_date: project.po_date,
  };
  useEffect(() => {
    if (editing) return;
    setNumber(project.po_number ?? '');
    setAmount(amountText(project.po_amount));
    setDate(project.po_date ?? '');
  }, [editing, project.po_number, project.po_amount, project.po_date]);

  const recorded = hasPurchaseOrder(saved);
  const left = poRemaining(saved, invoiced);
  const over = poOverrun(saved, invoiced);

  function save() {
    setError(null);
    start(async () => {
      const res = await setPurchaseOrderAction(project.id, {
        po_number: number,
        po_amount: amount,
        po_date: date,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not save that.');
        return;
      }
      setEditing(false);
      onChanged?.();
      router.refresh();
    });
  }

  function remove() {
    if (!confirm(`Remove PO ${project.po_number} from this job? Invoices keep their own PO.`)) {
      return;
    }
    setError(null);
    start(async () => {
      const res = await setPurchaseOrderAction(project.id, {
        po_number: '',
        po_amount: '',
        po_date: '',
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not remove that.');
        return;
      }
      setEditing(false);
      onChanged?.();
      router.refresh();
    });
  }

  return (
    <div className={variant === 'inline' ? '' : 'card p-5'}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="brand-heading text-sm text-brand-gray">Purchase Order</h2>
        {!editing && (
          <button
            type="button"
            className="text-xs font-medium text-brand-gray hover:text-brand-ink hover:underline"
            onClick={() => setEditing(true)}
          >
            {recorded ? 'Edit PO' : '+ Add PO'}
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
              PO #
            </label>
            <input
              className="input mt-1"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="e.g. PO-88214"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
                Amount Authorized
              </label>
              <input
                className="input mt-1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Optional"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
                Date Received
              </label>
              <input
                type="date"
                className="input mt-1"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-brand-gray">
            Leave the amount blank for a PO written against the contract with no figure of its own.
          </p>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {recorded ? (
              <button
                type="button"
                className="text-xs text-red-500 hover:underline"
                onClick={remove}
                disabled={pending}
              >
                remove PO
              </button>
            ) : (
              <span />
            )}
            <span className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary px-3 py-1 text-xs"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary px-3 py-1 text-xs"
                onClick={save}
                disabled={pending || !number.trim()}
                title={!number.trim() ? 'Enter the PO number' : undefined}
              >
                {pending ? 'Saving…' : 'Save PO'}
              </button>
            </span>
          </div>
        </div>
      ) : recorded ? (
        <div className="space-y-2">
          <p className="text-lg font-semibold text-brand-ink">{project.po_number}</p>
          <p className="tnum text-xs text-brand-gray">
            {project.po_amount != null
              ? `Authorizes ${money(project.po_amount, { cents: true })}`
              : 'Open against the contract — no amount on the PO'}
            {project.po_date ? ` · received ${shortDate(project.po_date)}` : ''}
          </p>

          {over != null ? (
            <p className="text-sm text-amber-700">
              Invoiced {money(over, { cents: true })} over what this PO authorizes — the customer
              needs a revised PO before the balance goes out.
            </p>
          ) : (
            left != null && (
              <p className="tnum text-sm text-brand-gray">
                <strong className="text-brand-ink">{money(left, { cents: true })}</strong> left on
                this PO
              </p>
            )
          )}

          <p className="text-xs text-brand-gray">New invoices start out billed against it.</p>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-amber-700">No customer PO on file.</p>
          <p className="text-xs text-brand-gray">
            {stage === 'ready_to_bill'
              ? 'This job is waiting to be billed — record the PO before the invoice goes out, and every invoice raised is filled in from it.'
              : 'Record it as soon as it arrives, and every invoice raised on this job is filled in from it.'}
          </p>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
