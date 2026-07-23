'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Combobox, type ComboboxOption } from '@/components/Combobox';
import { money } from '@/lib/format';
import type { QuoteItemKind } from '@/lib/types';
import {
  extractHeaderFromPdfText,
  parseSheet,
  parseNumber,
  toIsoDate,
  type DraftHeader,
  type DraftLine,
} from './parse';

export interface ExistingQuote {
  id: number;
  quote_number: string | null;
  customer: string;
  project_name: string | null;
}

const EMPTY_HEADER: DraftHeader = {
  quote_number: '',
  customer: '',
  project_name: '',
  category: '',
  bid_value: '',
  issue_date: '',
  valid_until: '',
};

interface ExtraHeader {
  customer_contact: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string;
  project_location: string;
  notes: string;
}
const EMPTY_EXTRA: ExtraHeader = {
  customer_contact: '',
  customer_email: '',
  customer_phone: '',
  customer_address: '',
  project_location: '',
  notes: '',
};

interface Attachment {
  id: number;
  file: File;
  role: 'pdf' | 'excel' | 'other';
}

const PDF_RE = /\.pdf$/i;
const EXCEL_RE = /\.(xlsx?|xlsm|csv)$/i;

/** Total of a single line: explicit amount, else qty × unit price. */
function lineTotal(l: DraftLine): number {
  const amt = parseNumber(l.amount);
  if (amt != null) return amt;
  return (parseNumber(l.quantity) ?? 0) * (parseNumber(l.unit_price) ?? 0);
}

let nextId = 1;

export function BulkUpload({ existing }: { existing: ExistingQuote[] }) {
  const [header, setHeader] = useState<DraftHeader>({ ...EMPTY_HEADER });
  const [extra, setExtra] = useState<ExtraHeader>({ ...EMPTY_EXTRA });
  const [showExtra, setShowExtra] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mode, setMode] = useState<'create' | 'update'>('create');
  const [updateId, setUpdateId] = useState('');
  const [defaultKind, setDefaultKind] = useState<QuoteItemKind>('display');

  const [pdfNoText, setPdfNoText] = useState(false);
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<null | { quoteId: number; mode: string; attached: number; skipped: string[] }>(
    null
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  const quoteOptions: ComboboxOption[] = useMemo(
    () =>
      existing.map((q) => ({
        value: String(q.id),
        label: q.quote_number || `Quote #${q.id}`,
        detail: [q.customer, q.project_name].filter(Boolean).join(' — '),
      })),
    [existing]
  );

  const displayLines = lines.filter((l) => l.kind === 'display' && l.description.trim());
  const displayTotal = displayLines.reduce((s, l) => s + lineTotal(l), 0);
  const hasDisplay = displayLines.length > 0;
  const manualBid = parseNumber(header.bid_value) ?? 0;
  const effectiveBid = hasDisplay ? displayTotal : manualBid;

  /* --------------------------------------------------------------- files */

  async function handleFiles(fileList: FileList | File[]) {
    setError('');
    const files = Array.from(fileList);
    for (const file of files) {
      const role: Attachment['role'] = PDF_RE.test(file.name)
        ? 'pdf'
        : EXCEL_RE.test(file.name)
          ? 'excel'
          : 'other';
      setAttachments((prev) => [...prev, { id: nextId++, file, role }]);

      try {
        if (role === 'pdf') await ingestPdf(file);
        else if (role === 'excel') await ingestExcel(file);
      } catch (err) {
        console.error(err);
        setError(`Could not read ${file.name}. You can still enter its details by hand.`);
      }
    }
  }

  async function ingestPdf(file: File) {
    setBusy(`Reading ${file.name}…`);
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await getDocumentProxy(data);
      const { text } = await extractText(pdf, { mergePages: true });
      const clean = (text || '').trim();
      setPdfNoText(clean.length === 0);
      if (clean.length === 0) return;

      const parsed = extractHeaderFromPdfText(clean);
      // Fill only empty fields so a manual edit or a prior file isn't clobbered.
      setHeader((h) => fillEmpty(h, parsed));

      // Auto-match to an existing quote by quote number.
      if (parsed.quote_number) {
        const match = existing.find(
          (q) => (q.quote_number || '').toLowerCase() === parsed.quote_number.toLowerCase()
        );
        if (match) {
          setMode('update');
          setUpdateId(String(match.id));
        }
      }
    } finally {
      setBusy(null);
    }
  }

  async function ingestExcel(file: File) {
    setBusy(`Reading ${file.name}…`);
    try {
      const XLSX = await import('xlsx');
      const data = new Uint8Array(await file.arrayBuffer());
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) return;
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        blankrows: false,
        defval: '',
      });
      const { lines: parsedLines, header: parsedHeader } = parseSheet(aoa, defaultKind);
      if (parsedLines.length) setLines((prev) => [...prev, ...parsedLines]);
      setHeader((h) => fillEmpty(h, parsedHeader));
    } finally {
      setBusy(null);
    }
  }

  function fillEmpty(current: DraftHeader, incoming: Partial<DraftHeader>): DraftHeader {
    const next = { ...current };
    (Object.keys(incoming) as (keyof DraftHeader)[]).forEach((k) => {
      const v = incoming[k];
      if (v && !next[k]) next[k] = v;
    });
    return next;
  }

  function removeAttachment(id: number) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  /* --------------------------------------------------------------- lines */

  function addLine() {
    setLines((prev) => [
      ...prev,
      { kind: defaultKind, description: '', quantity: '', unit: '', unit_price: '', amount: '', cost_type: '' },
    ]);
  }
  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  /* --------------------------------------------------------------- save */

  function reset() {
    setHeader({ ...EMPTY_HEADER });
    setExtra({ ...EMPTY_EXTRA });
    setLines([]);
    setAttachments([]);
    setMode('create');
    setUpdateId('');
    setPdfNoText(false);
    setError('');
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function save() {
    setError('');
    if (!header.customer.trim()) {
      setError('Customer is required.');
      return;
    }
    if (mode === 'update' && !updateId) {
      setError('Choose the existing quote to update.');
      return;
    }

    const doc = {
      quote_number: header.quote_number.trim() || null,
      customer: header.customer.trim(),
      customer_contact: extra.customer_contact.trim() || null,
      customer_email: extra.customer_email.trim() || null,
      customer_phone: extra.customer_phone.trim() || null,
      customer_address: extra.customer_address.trim() || null,
      project_name: header.project_name.trim() || null,
      project_location: extra.project_location.trim() || null,
      category: header.category.trim() || null,
      issue_date: toIsoDate(header.issue_date) || null,
      valid_until: toIsoDate(header.valid_until) || null,
      tax_rate: 0,
      markup_rate: 0,
      terms: null,
      notes: extra.notes.trim() || null,
      prepared_by: null,
      internal_notes: null,
      items: lines
        .filter((l) => l.description.trim())
        .map((l) => ({
          kind: l.kind,
          description: l.description.trim(),
          quantity: parseNumber(l.quantity) ?? 0,
          unit: l.unit.trim() || null,
          unit_price: parseNumber(l.unit_price) ?? 0,
          amount: parseNumber(l.amount),
          markup_rate: 0,
          cost_type: l.cost_type.trim() || null,
        })),
    };

    const payload = {
      mode,
      quoteId: mode === 'update' ? Number(updateId) : undefined,
      bidValue: parseNumber(header.bid_value),
      doc,
    };

    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    for (const a of attachments) form.append('file', a.file, a.file.name);

    setBusy('Saving quote…');
    try {
      const res = await fetch('/api/bulk-upload/commit', { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setError(json.error || 'Save failed. Please try again.');
        return;
      }
      setResult({
        quoteId: json.quoteId,
        mode,
        attached: Array.isArray(json.attached) ? json.attached.length : 0,
        skipped: Array.isArray(json.skipped) ? json.skipped : [],
      });
    } catch {
      setError('Network error while saving. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  /* --------------------------------------------------------------- render */

  if (result) {
    return (
      <div className="card max-w-2xl p-6">
        <h2 className="brand-heading text-lg text-brand-ink">
          Quote {result.mode === 'update' ? 'updated' : 'created'}
        </h2>
        <p className="mt-2 text-sm text-brand-gray">
          {result.attached} file{result.attached === 1 ? '' : 's'} attached to the quote.
          {result.skipped.length > 0 && (
            <span className="mt-1 block text-red-600">
              Skipped (over 10 MB): {result.skipped.join(', ')}
            </span>
          )}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={`/quotes/${result.quoteId}/edit`} className="btn-secondary">
            Open the quote
          </Link>
          <button onClick={reset} className="btn-primary">
            Next quote
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Dropzone */}
      <div className="card p-5">
        <label className="label">Files</label>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-black/15 bg-black/[0.02] px-4 py-8 text-center transition hover:border-brand-green"
        >
          <p className="text-sm font-medium text-brand-ink">
            Drop the quote PDF and its Excel here, or click to choose
          </p>
          <p className="mt-1 text-xs text-brand-gray">
            The PDF fills the header; the Excel fills the line items. Every file is attached to the
            quote. PDF · Excel/CSV · up to 10 MB each.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.xlsx,.xls,.xlsm,.csv"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) handleFiles(e.target.files);
            }}
          />
        </div>

        {busy && <p className="mt-3 text-sm text-brand-gray">{busy}</p>}

        {attachments.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {attachments.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-black/5 bg-white px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="badge bg-black/5 text-brand-gray uppercase">{a.role}</span>
                  <span className="truncate text-brand-ink">{a.file.name}</span>
                </span>
                <button
                  onClick={() => removeAttachment(a.id)}
                  className="shrink-0 text-xs font-medium text-red-600 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {pdfNoText && (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No text could be read from the PDF (it may be a scan/image). Enter the quote details by
            hand below — the PDF is still attached.
          </p>
        )}
      </div>

      {/* Create vs update */}
      <div className="card p-5">
        <label className="label">Save as</label>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="mode"
              checked={mode === 'create'}
              onChange={() => setMode('create')}
            />
            Create a new quote
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="mode"
              checked={mode === 'update'}
              onChange={() => setMode('update')}
            />
            Update an existing quote
          </label>
        </div>
        {mode === 'update' && (
          <div className="mt-3 max-w-md">
            <Combobox
              options={quoteOptions}
              value={updateId}
              onSelect={setUpdateId}
              placeholder="Search quotes by number, customer, project…"
              emptyText="No matching quote"
            />
            <p className="mt-1 text-xs text-brand-gray">
              The fields and line items below will replace this quote&apos;s current details; the new
              files are added to it.
            </p>
          </div>
        )}
      </div>

      {/* Header fields */}
      <div className="card p-5">
        <label className="label">Quote details</label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Quote #" value={header.quote_number} onChange={(v) => setHeader((h) => ({ ...h, quote_number: v }))} />
          <Field label="Customer *" value={header.customer} onChange={(v) => setHeader((h) => ({ ...h, customer: v }))} />
          <Field label="Project / Description" value={header.project_name} onChange={(v) => setHeader((h) => ({ ...h, project_name: v }))} />
          <Field label="Category" value={header.category} onChange={(v) => setHeader((h) => ({ ...h, category: v }))} />
          <div>
            <label className="label">Bid value</label>
            <input
              className="input"
              inputMode="decimal"
              value={header.bid_value}
              disabled={hasDisplay}
              onChange={(e) => setHeader((h) => ({ ...h, bid_value: e.target.value }))}
              placeholder="$0"
            />
            <p className="mt-1 text-xs text-brand-gray">
              {hasDisplay
                ? `Calculated from line items: ${money(displayTotal)}`
                : 'Used when there are no customer-facing line items.'}
            </p>
          </div>
          <Field label="Issue date" value={header.issue_date} onChange={(v) => setHeader((h) => ({ ...h, issue_date: v }))} placeholder="YYYY-MM-DD" />
          <Field label="Valid until" value={header.valid_until} onChange={(v) => setHeader((h) => ({ ...h, valid_until: v }))} placeholder="YYYY-MM-DD" />
        </div>

        <button
          type="button"
          onClick={() => setShowExtra((s) => !s)}
          className="mt-4 text-xs font-semibold text-brand-green-dark hover:underline"
        >
          {showExtra ? 'Hide' : 'Show'} contact &amp; notes fields
        </button>
        {showExtra && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Contact name" value={extra.customer_contact} onChange={(v) => setExtra((x) => ({ ...x, customer_contact: v }))} />
            <Field label="Contact email" value={extra.customer_email} onChange={(v) => setExtra((x) => ({ ...x, customer_email: v }))} />
            <Field label="Contact phone" value={extra.customer_phone} onChange={(v) => setExtra((x) => ({ ...x, customer_phone: v }))} />
            <Field label="Customer address" value={extra.customer_address} onChange={(v) => setExtra((x) => ({ ...x, customer_address: v }))} />
            <Field label="Project location" value={extra.project_location} onChange={(v) => setExtra((x) => ({ ...x, project_location: v }))} />
            <Field label="Notes" value={extra.notes} onChange={(v) => setExtra((x) => ({ ...x, notes: v }))} />
          </div>
        )}
      </div>

      {/* Line items */}
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <label className="label mb-0">Line items</label>
          <div className="flex items-center gap-2 text-xs text-brand-gray">
            <span>New Excel rows import as</span>
            <select
              className="input !w-auto !py-1"
              value={defaultKind}
              onChange={(e) => setDefaultKind(e.target.value as QuoteItemKind)}
            >
              <option value="display">Line items (on quote)</option>
              <option value="pricing">Internal pricing</option>
            </select>
          </div>
        </div>

        {lines.length === 0 ? (
          <p className="text-sm text-brand-gray">
            No line items yet. Add an Excel file above, or add rows manually.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-brand-gray">
                  <th className="pb-2 pr-2">Type</th>
                  <th className="pb-2 pr-2">Description</th>
                  <th className="pb-2 pr-2 w-20">Qty</th>
                  <th className="pb-2 pr-2 w-20">Unit</th>
                  <th className="pb-2 pr-2 w-28">Unit price</th>
                  <th className="pb-2 pr-2 w-28">Amount</th>
                  <th className="pb-2 pr-2 w-28">Line total</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-black/5 align-top">
                    <td className="py-1.5 pr-2">
                      <select
                        className="input !py-1"
                        value={l.kind}
                        onChange={(e) => updateLine(i, { kind: e.target.value as QuoteItemKind })}
                      >
                        <option value="display">Line</option>
                        <option value="pricing">Pricing</option>
                      </select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <input className="input !py-1" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input className="input !py-1" inputMode="decimal" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input className="input !py-1" value={l.unit} onChange={(e) => updateLine(i, { unit: e.target.value })} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input className="input !py-1" inputMode="decimal" value={l.unit_price} onChange={(e) => updateLine(i, { unit_price: e.target.value })} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input className="input !py-1" inputMode="decimal" value={l.amount} onChange={(e) => updateLine(i, { amount: e.target.value })} placeholder="auto" />
                    </td>
                    <td className="py-2.5 pr-2 text-brand-ink">{money(lineTotal(l), { cents: true })}</td>
                    <td className="py-1.5 text-right">
                      <button onClick={() => removeLine(i)} className="text-xs font-medium text-red-600 hover:underline">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button onClick={addLine} className="btn-secondary mt-3 !py-1.5 text-xs">
          + Add line
        </button>
      </div>

      {/* Footer / save */}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="text-sm">
          <span className="text-brand-gray">Bid value to save: </span>
          <span className="font-bold text-brand-ink">{money(effectiveBid)}</span>
        </div>
        <div className="flex items-center gap-3">
          {error && <span className="text-sm font-medium text-red-600">{error}</span>}
          <button onClick={reset} className="btn-secondary" disabled={!!busy}>
            Clear
          </button>
          <button onClick={save} className="btn-primary" disabled={!!busy}>
            {busy === 'Saving quote…' ? 'Saving…' : mode === 'update' ? 'Update quote' : 'Create quote'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
