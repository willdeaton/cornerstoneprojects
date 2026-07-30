'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Project, ProjectInvoice } from '@/lib/types';
import { money } from '@/lib/format';
import { updateInvoiceAction, type InvoiceInput } from '@/app/actions/projects';

/**
 * Invoicing card with inline editing — no "Edit" modal required. Each invoice
 * carries its own number and amount plus two independent flags: Billed (it has
 * gone out to the customer) and Paid (the money has come in). Rows are added,
 * edited and removed locally; a Save/Cancel row appears once anything changes
 * and commits the whole card at once.
 */

/** Client-side row: mirrors a saved invoice, or has a null id when brand new. */
interface Row {
  /** Stable key for React — a saved row's id, or a negative counter for a new one. */
  key: number;
  id: number | null;
  invoice_number: string;
  amount: string;
  billed: boolean;
  paid: boolean;
}

function toRows(invoices: ProjectInvoice[]): Row[] {
  return invoices.map((inv) => ({
    key: inv.id,
    id: inv.id,
    invoice_number: inv.invoice_number ?? '',
    // Whole dollars stay bare; anything with cents shows both decimal places.
    amount: inv.amount ? (Number.isInteger(inv.amount) ? String(inv.amount) : inv.amount.toFixed(2)) : '',
    billed: inv.billed,
    paid: inv.paid,
  }));
}

/** Amount as typed ("$1,200.50") turned into a number for the running totals. */
function parseAmount(raw: string): number {
  const n = parseFloat(raw.replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

export function InvoiceSection({
  project,
  invoices,
}: {
  project: Project;
  invoices: ProjectInvoice[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => toRows(invoices));
  const [notes, setNotes] = useState(project.invoice_notes ?? '');
  const [pending, start] = useTransition();
  const notesRef = useRef<HTMLTextAreaElement>(null);
  // Counter for keys on unsaved rows; negative so it can't collide with an id.
  const nextKey = useRef(-1);

  const saved = JSON.stringify(toRows(invoices).map(({ key: _key, ...r }) => r));
  const current = JSON.stringify(rows.map(({ key: _key, ...r }) => r));
  const dirty = current !== saved || notes !== (project.invoice_notes ?? '');

  // Keep local state in sync if the project refreshes underneath us (e.g. after
  // a save elsewhere) as long as the user isn't mid-edit.
  useEffect(() => {
    if (!dirty) {
      setRows(toRows(invoices));
      setNotes(project.invoice_notes ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, project.invoice_notes]);

  // Auto-grow the notes textarea to fit its content.
  useEffect(() => {
    const el = notesRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [notes]);

  function patch(key: number, fields: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...fields } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        key: nextKey.current--,
        id: null,
        invoice_number: '',
        amount: '',
        billed: false,
        paid: false,
      },
    ]);
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  function save() {
    const payload: InvoiceInput[] = rows
      // Drop rows the user added but never filled in.
      .filter((r) => r.id != null || r.invoice_number.trim() || parseAmount(r.amount) > 0)
      .map((r) => ({
        id: r.id,
        invoice_number: r.invoice_number,
        amount: r.amount,
        billed: r.billed,
        paid: r.paid,
      }));
    const fd = new FormData();
    fd.set('invoice_notes', notes);
    start(async () => {
      await updateInvoiceAction(project.id, payload, fd);
      router.refresh();
    });
  }

  function cancel() {
    setRows(toRows(invoices));
    setNotes(project.invoice_notes ?? '');
  }

  const total = rows.reduce((sum, r) => sum + parseAmount(r.amount), 0);
  const billed = rows.reduce((sum, r) => sum + (r.billed || r.paid ? parseAmount(r.amount) : 0), 0);
  const paid = rows.reduce((sum, r) => sum + (r.paid ? parseAmount(r.amount) : 0), 0);

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="brand-heading text-sm text-brand-gray">
          Invoicing{' '}
          {rows.length > 0 && <span className="text-brand-gray/70">({rows.length})</span>}
        </h2>
        {dirty && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary px-3 py-1 text-xs"
              onClick={cancel}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary px-3 py-1 text-xs"
              onClick={save}
              disabled={pending}
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="py-3 text-center text-sm text-brand-gray">
          No invoices yet — add the first one below.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Column headers, on wide screens only — each field is labelled
              inline on narrow ones. */}
          <div className="hidden gap-3 px-1 text-xs font-semibold uppercase tracking-wide text-brand-gray sm:grid sm:grid-cols-[1fr_9rem_5rem_5rem_4rem]">
            <span>Invoice #</span>
            <span>Amount</span>
            <span className="text-center">Billed</span>
            <span className="text-center">Paid</span>
            <span />
          </div>

          {rows.map((r) => (
            <div
              key={r.key}
              className="grid items-center gap-3 rounded-xl border border-black/5 bg-black/[0.02] p-3 sm:grid-cols-[1fr_9rem_5rem_5rem_4rem] sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0"
            >
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-brand-gray sm:hidden">
                  Invoice #
                </label>
                <input
                  className="input mt-1 sm:mt-0"
                  value={r.invoice_number}
                  onChange={(e) => patch(r.key, { invoice_number: e.target.value })}
                  placeholder="e.g. INV-1042"
                />
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-brand-gray sm:hidden">
                  Amount
                </label>
                <input
                  className="input mt-1 sm:mt-0"
                  value={r.amount}
                  onChange={(e) => patch(r.key, { amount: e.target.value })}
                  placeholder="0.00"
                  inputMode="decimal"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-brand-ink sm:justify-center">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-green"
                  checked={r.billed || r.paid}
                  // A paid invoice is billed by definition, so the flag is
                  // locked on until Paid is cleared.
                  disabled={r.paid}
                  onChange={(e) => patch(r.key, { billed: e.target.checked })}
                />
                <span className="sm:hidden">Billed</span>
              </label>

              <label className="flex items-center gap-2 text-sm text-brand-ink sm:justify-center">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-green"
                  checked={r.paid}
                  onChange={(e) =>
                    patch(r.key, {
                      paid: e.target.checked,
                      billed: e.target.checked ? true : r.billed,
                    })
                  }
                />
                <span className="sm:hidden">Paid</span>
              </label>

              <button
                type="button"
                onClick={() => removeRow(r.key)}
                aria-label={`Remove invoice ${r.invoice_number || ''}`.trim()}
                title="Remove invoice"
                className="justify-self-start text-xs text-red-500 hover:underline sm:justify-self-center"
              >
                remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={addRow}>
          + Add Invoice
        </button>
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-brand-gray">
            <span>
              Invoiced <strong className="text-brand-ink">{money(total, { cents: true })}</strong>
            </span>
            <span>
              Billed <strong className="text-brand-ink">{money(billed, { cents: true })}</strong>
            </span>
            <span>
              Paid <strong className="text-brand-ink">{money(paid, { cents: true })}</strong>
            </span>
          </div>
        )}
      </div>

      <div className="mt-4">
        <label className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
          Invoice Notes
        </label>
        <textarea
          ref={notesRef}
          className="input mt-1 min-h-[70px] resize-y"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Billing terms, PO numbers, partial-invoice status…"
        />
      </div>
    </div>
  );
}
