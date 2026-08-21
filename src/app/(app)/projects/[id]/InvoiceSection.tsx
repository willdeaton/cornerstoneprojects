'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Project, ProjectInvoiceWithFile } from '@/lib/types';
import { money } from '@/lib/format';
import { updateInvoiceAction, type InvoiceInput } from '@/app/actions/projects';
import { uploadInvoicePdfAction } from '@/app/actions/billing';

/**
 * Invoicing card with inline editing — no "Edit" modal required. Each invoice
 * carries the four things billing has to be able to answer for: its number and
 * the customer's PO, how much was billed, the day it went out, and the PDF that
 * was sent. Paid is tracked separately from sent, so an invoice can be out and
 * unpaid, and the running totals along the bottom end on the number the desk
 * actually wants — how much of the contract is still left to bill.
 *
 * Rows are added, edited and removed locally; a Save/Cancel row appears once
 * anything changes and commits the whole card at once. A PDF picked against a
 * brand-new row is uploaded straight after that row is saved, which is why the
 * save action hands back the id of every row it wrote.
 */

/** Client-side row: mirrors a saved invoice, or has a null id when brand new. */
interface Row {
  /** Stable key for React — a saved row's id, or a negative counter for a new one. */
  key: number;
  id: number | null;
  invoice_number: string;
  po_number: string;
  amount: string;
  /** Whether it has gone out to the customer. `sent_on` is the day it did. */
  billed: boolean;
  sent_on: string;
  paid: boolean;
  /** The attachment already on the invoice, if any. */
  pdf_filename: string | null;
  pdf_size: number | null;
  /** A file picked in this edit, uploaded when the card is saved. */
  file: File | null;
  /** Detach the saved attachment when the card is saved. */
  remove_pdf: boolean;
}

/** How a saved amount reads in the input: whole dollars bare, cents in full. */
function amountText(amount: number): string {
  if (!amount) return '';
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function toRows(invoices: ProjectInvoiceWithFile[]): Row[] {
  return invoices.map((inv) => ({
    key: inv.id,
    id: inv.id,
    invoice_number: inv.invoice_number ?? '',
    po_number: inv.po_number ?? '',
    amount: amountText(inv.amount),
    billed: inv.billed,
    sent_on: inv.sent_on ?? '',
    paid: inv.paid,
    pdf_filename: inv.pdf_filename,
    pdf_size: inv.pdf_size,
    file: null,
    remove_pdf: false,
  }));
}

/** Amount as typed ("$1,200.50") turned into a number for the running totals. */
function parseAmount(raw: string): number {
  const n = parseFloat(raw.replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** Today as YYYY-MM-DD in the browser's own timezone, for the date input. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What goes into the dirty check — everything except React's own key. */
function comparable(rows: Row[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      id: r.id,
      invoice_number: r.invoice_number,
      po_number: r.po_number,
      amount: r.amount,
      billed: r.billed,
      sent_on: r.sent_on,
      paid: r.paid,
      // The File itself can't be compared, but picking one is a change.
      file: r.file ? r.file.name : null,
      remove_pdf: r.remove_pdf,
    }))
  );
}

export function InvoiceSection({
  project,
  invoices,
}: {
  project: Project;
  invoices: ProjectInvoiceWithFile[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => toRows(invoices));
  const [notes, setNotes] = useState(project.invoice_notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const notesRef = useRef<HTMLTextAreaElement>(null);
  // Counter for keys on unsaved rows; negative so it can't collide with an id.
  const nextKey = useRef(-1);

  const saved = comparable(toRows(invoices));
  const current = comparable(rows);
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
        po_number: '',
        amount: '',
        billed: false,
        sent_on: '',
        paid: false,
        pdf_filename: null,
        pdf_size: null,
        file: null,
        remove_pdf: false,
      },
    ]);
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  function save() {
    // Drop rows the user added but never filled in, keeping each kept row's
    // picked file alongside it — the upload needs the id this save hands back.
    const keep = rows.filter(
      (r) =>
        r.id != null ||
        r.invoice_number.trim() ||
        r.po_number.trim() ||
        parseAmount(r.amount) > 0 ||
        r.file
    );
    const payload: InvoiceInput[] = keep.map((r) => ({
      id: r.id,
      invoice_number: r.invoice_number,
      po_number: r.po_number,
      amount: r.amount,
      billed: r.billed,
      sent_on: r.sent_on,
      paid: r.paid,
      remove_pdf: r.remove_pdf,
    }));
    const fd = new FormData();
    fd.set('invoice_notes', notes);

    setError(null);
    start(async () => {
      const { ids } = await updateInvoiceAction(project.id, payload, fd);
      // Attachments go up after the rows exist, so a PDF can be picked against
      // an invoice that is still being typed.
      const failed = new Map<number, string>();
      for (const [i, r] of keep.entries()) {
        if (!r.file) continue;
        const invoiceId = ids[i];
        if (invoiceId == null) continue;
        const upload = new FormData();
        upload.set('file', r.file);
        const res = await uploadInvoicePdfAction(project.id, invoiceId, upload);
        if (res.error) failed.set(i, `${r.invoice_number || r.file.name}: ${res.error}`);
      }
      // Bring local state up to what was just written — ids for the rows that
      // were new, and each attachment now settled — so the card reads as saved
      // and the next refresh can sync it from the server. A file that failed to
      // attach stays pending, so Save can be pressed again to retry it.
      setRows(
        keep.map((r, i) => {
          const stuck = failed.has(i);
          return {
            ...r,
            id: ids[i] ?? r.id,
            // As the server stored it, so "$12,500.75" as typed stops reading
            // as an unsaved change the moment it has been saved.
            amount: amountText(parseAmount(r.amount)),
            invoice_number: r.invoice_number.trim(),
            po_number: r.po_number.trim(),
            file: stuck ? r.file : null,
            remove_pdf: false,
            pdf_filename: stuck
              ? r.pdf_filename
              : r.file
                ? r.file.name
                : r.remove_pdf
                  ? null
                  : r.pdf_filename,
            pdf_size: stuck ? r.pdf_size : r.file ? r.file.size : r.remove_pdf ? null : r.pdf_size,
          };
        })
      );
      if (failed.size) {
        setError(`Saved, but the file didn't attach — ${[...failed.values()].join('; ')}`);
      }
      router.refresh();
    });
  }

  function cancel() {
    setRows(toRows(invoices));
    setNotes(project.invoice_notes ?? '');
    setError(null);
  }

  const total = rows.reduce((sum, r) => sum + parseAmount(r.amount), 0);
  const billed = rows.reduce((sum, r) => sum + (r.billed || r.paid ? parseAmount(r.amount) : 0), 0);
  const paid = rows.reduce((sum, r) => sum + (r.paid ? parseAmount(r.amount) : 0), 0);
  // What's still to bill on the job: the contract less what has actually gone
  // out. Over-billing shows as nothing left rather than a negative figure —
  // the Billing card is where an over-bill is called out.
  const leftToBill = project.value - billed;

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

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {rows.length === 0 ? (
        <p className="py-3 text-center text-sm text-brand-gray">
          No invoices yet — add the first one below.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div
              key={r.key}
              className="rounded-xl border border-black/5 bg-black/[0.02] p-3"
            >
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem]">
                <Field label="Invoice #">
                  <input
                    className="input"
                    value={r.invoice_number}
                    onChange={(e) => patch(r.key, { invoice_number: e.target.value })}
                    placeholder="e.g. INV-1042"
                  />
                </Field>
                <Field label="PO #">
                  <input
                    className="input"
                    value={r.po_number}
                    onChange={(e) => patch(r.key, { po_number: e.target.value })}
                    placeholder="Customer PO"
                  />
                </Field>
                <Field label="Amount Billed">
                  <input
                    className="input"
                    value={r.amount}
                    onChange={(e) => patch(r.key, { amount: e.target.value })}
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                </Field>
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
                <label className="flex items-center gap-2 pb-2 text-sm text-brand-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-green"
                    checked={r.billed || r.paid}
                    // A paid invoice went out by definition, so the flag is
                    // locked on until Paid is cleared.
                    disabled={r.paid}
                    onChange={(e) =>
                      patch(
                        r.key,
                        e.target.checked
                          ? // Ticking Sent without a date almost always means
                            // "today"; it stays editable either way.
                            { billed: true, sent_on: r.sent_on || todayIso() }
                          : { billed: false, sent_on: '' }
                      )
                    }
                  />
                  Sent
                </label>

                <Field label="Date Sent">
                  <input
                    type="date"
                    className="input w-[10.5rem]"
                    value={r.sent_on}
                    onChange={(e) =>
                      patch(r.key, {
                        sent_on: e.target.value,
                        // A date is the other way of saying it went out.
                        billed: e.target.value ? true : r.billed,
                      })
                    }
                  />
                </Field>

                <label className="flex items-center gap-2 pb-2 text-sm text-brand-ink">
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
                  Paid
                </label>

                <div className="min-w-[13rem] flex-1 pb-1">
                  <InvoicePdf row={r} onPatch={(fields) => patch(r.key, fields)} />
                </div>

                <button
                  type="button"
                  onClick={() => removeRow(r.key)}
                  aria-label={`Remove invoice ${r.invoice_number || ''}`.trim()}
                  title="Remove invoice"
                  className="pb-2 text-xs text-red-500 hover:underline"
                >
                  remove invoice
                </button>
              </div>
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
              Sent <strong className="text-brand-ink">{money(billed, { cents: true })}</strong>
            </span>
            <span>
              Paid <strong className="text-brand-ink">{money(paid, { cents: true })}</strong>
            </span>
            <span>
              Left to Bill{' '}
              <strong className={leftToBill > 0 ? 'text-amber-700' : 'text-brand-ink'}>
                {money(Math.max(0, leftToBill), { cents: true })}
              </strong>
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
          placeholder="Billing terms, retainage, partial-invoice status…"
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * The invoice document: what is attached, what is about to be, and what is
 * about to go. Picking or clearing a file only changes the row — the card's
 * Save is what uploads or detaches it, so one Cancel undoes the lot.
 */
function InvoicePdf({ row, onPatch }: { row: Row; onPatch: (fields: Partial<Row>) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const attached = row.pdf_filename && !row.remove_pdf;

  return (
    <div className="text-xs">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          if (file) onPatch({ file, remove_pdf: false });
          // Let the same file be re-picked after a cancel.
          e.target.value = '';
        }}
      />

      {row.file ? (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-brand-ink">{row.file.name}</span>
          <span className="text-brand-gray">
            {fileSize(row.file.size)} · attaches on save
          </span>
          <button
            type="button"
            className="text-red-500 hover:underline"
            onClick={() => onPatch({ file: null })}
          >
            cancel
          </button>
        </span>
      ) : attached ? (
        <span className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/invoices/${row.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="max-w-[14rem] truncate font-medium text-brand-ink hover:text-brand-green-dark hover:underline"
          >
            {row.pdf_filename}
          </a>
          {row.pdf_size != null && <span className="text-brand-gray">{fileSize(row.pdf_size)}</span>}
          <button
            type="button"
            className="text-brand-gray hover:underline"
            onClick={() => inputRef.current?.click()}
          >
            replace
          </button>
          <button
            type="button"
            className="text-red-500 hover:underline"
            onClick={() => onPatch({ remove_pdf: true })}
          >
            remove
          </button>
        </span>
      ) : row.remove_pdf ? (
        <span className="flex flex-wrap items-center gap-2 text-brand-gray">
          {row.pdf_filename} removed on save
          <button
            type="button"
            className="text-brand-ink hover:underline"
            onClick={() => onPatch({ remove_pdf: false })}
          >
            undo
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="font-medium text-brand-green-dark hover:underline"
          onClick={() => inputRef.current?.click()}
        >
          + Attach invoice PDF
        </button>
      )}
    </div>
  );
}
