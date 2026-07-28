'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Combobox, type ComboboxOption } from '@/components/Combobox';
import { Modal } from '@/components/Modal';
import { RichTextEditor } from '@/components/RichTextEditor';
import { money } from '@/lib/format';
import { isRichTextEmpty, sanitizeRichText } from '@/lib/richtext';
import type { QuoteItemKind, CustomerWithContacts } from '@/lib/types';
import { quickAddCustomerAction } from '@/app/actions/catalog';
import {
  extractHeaderFromPdfText,
  extractMarkupPercent,
  extractProposal,
  groupItemsIntoLines,
  parseSheet,
  parseNumber,
  toIsoDate,
  type DraftHeader,
  type DraftLine,
  type PdfTextItem,
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
  name: string;
  size: number;
  /** Snapshot of the file's bytes taken when it was added. Uploading this copy
   *  (instead of the live File handle) means the save can't fail with a
   *  "file changed" network error when the original is re-saved on disk —
   *  e.g. an Excel still open in Excel, or a OneDrive-synced folder. */
  blob: Blob;
  role: 'pdf' | 'excel' | 'other';
  /** Over the server's 10 MB cap — kept in the list but never uploaded. */
  tooBig: boolean;
}

const PDF_RE = /\.pdf$/i;
const EXCEL_RE = /\.(xlsx?|xlsm|csv)$/i;
/** Per-file upload cap, matching the commit endpoint's MAX_BYTES. */
const MAX_FILE_BYTES = 10_000_000;

const norm = (s: string) => s.trim().toLowerCase();

/** Total of a single line: explicit amount, else qty × unit price. */
function lineTotal(l: DraftLine): number {
  const amt = parseNumber(l.amount);
  if (amt != null) return amt;
  return (parseNumber(l.quantity) ?? 0) * (parseNumber(l.unit_price) ?? 0);
}

let nextId = 1;

const blankAddForm = { name: '', address: '', contactName: '', email: '', phone: '' };

export function BulkUpload({
  existing,
  customers: customersProp = [],
}: {
  existing: ExistingQuote[];
  customers?: CustomerWithContacts[];
}) {
  const [header, setHeader] = useState<DraftHeader>({ ...EMPTY_HEADER });
  const [extra, setExtra] = useState<ExtraHeader>({ ...EMPTY_EXTRA });
  const [showExtra, setShowExtra] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mode, setMode] = useState<'create' | 'update'>('create');
  const [updateId, setUpdateId] = useState('');

  // Saved customers held in state so a quick-add shows up immediately.
  const [customers, setCustomers] = useState<CustomerWithContacts[]>(customersProp);

  // Excel worksheets: every sheet's rows are parsed up front and kept in a ref.
  // Pricing Details and (optionally) Line Items each pick their own sheet.
  const sheetsRef = useRef<Record<string, unknown[][]>>({});
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [pricingSheet, setPricingSheet] = useState('');
  const [lineSheet, setLineSheet] = useState('');
  // Markup % for the pricing worksheet, read off the Excel's Estimate Summary
  // ("Markup (%)" row) and editable. Comparison-only: it is never applied to
  // the saved items — imported line prices already include markup.
  const [markup, setMarkup] = useState('');
  // Where customer-facing line items come from. PDFs fill them directly; with
  // no PDF the user can point Line Items at an Excel worksheet instead.
  const [lineSource, setLineSource] = useState<'pdf' | 'excel'>('pdf');

  // Add-customer modal.
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(blankAddForm);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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

  /* ------------------------------------------------------------ customers */

  const matchedCustomer = customers.find((c) => norm(c.name) === norm(header.customer));
  // When the customer name came from the PDF (or was typed) and isn't a saved
  // record, offer it as a "current" option so the field shows it.
  const customerSelValue = matchedCustomer
    ? String(matchedCustomer.id)
    : header.customer.trim()
      ? '__current__'
      : '';

  const customerOptions: ComboboxOption[] = useMemo(() => {
    const opts: ComboboxOption[] = customers
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ value: String(c.id), label: c.name, detail: c.address ?? undefined }));
    if (!matchedCustomer && header.customer.trim()) {
      opts.unshift({ value: '__current__', label: header.customer, detail: 'From PDF · not saved yet' });
    }
    return opts;
  }, [customers, matchedCustomer, header.customer]);

  function onSelectCustomer(value: string) {
    if (value === '__current__') return;
    const c = customers.find((x) => String(x.id) === value);
    if (!c) return;
    setHeader((h) => ({ ...h, customer: c.name }));
    // Prefill address/contact from the saved customer when empty.
    const first = c.contacts[0];
    setExtra((x) => ({
      ...x,
      customer_address: x.customer_address || c.address || '',
      customer_contact: x.customer_contact || first?.name || '',
      customer_email: x.customer_email || first?.email || '',
      customer_phone: x.customer_phone || first?.phone || '',
    }));
  }

  function openAddCustomer(typed: string) {
    setAddError(null);
    setAddForm({ ...blankAddForm, name: typed });
    setAddOpen(true);
  }

  async function confirmAddCustomer() {
    setAddError(null);
    if (!addForm.name.trim()) {
      setAddError('Customer name is required.');
      return;
    }
    setAddSaving(true);
    try {
      const res = await quickAddCustomerAction({
        name: addForm.name,
        address: addForm.address || null,
        contact: addForm.contactName
          ? { name: addForm.contactName, email: addForm.email, phone: addForm.phone }
          : null,
      });
      if (!res.ok || !res.customer) {
        setAddError(res.error ?? 'Could not add the customer.');
        setAddSaving(false);
        return;
      }
      const created = res.customer;
      setCustomers((cs) => [...cs, created].sort((a, b) => a.name.localeCompare(b.name)));
      setHeader((h) => ({ ...h, customer: created.name }));
      const first = created.contacts[0];
      setExtra((x) => ({
        ...x,
        customer_address: created.address ?? x.customer_address,
        customer_contact: first?.name ?? x.customer_contact,
        customer_email: first?.email ?? x.customer_email,
        customer_phone: first?.phone ?? x.customer_phone,
      }));
      setAddOpen(false);
    } catch {
      setAddError('Could not save. You may not have permission to add customers.');
    } finally {
      setAddSaving(false);
    }
  }

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

      // Read the bytes NOW and keep the copy — parsing and the eventual upload
      // both use the snapshot, never the live file handle.
      let buf: ArrayBuffer;
      try {
        buf = await file.arrayBuffer();
      } catch (err) {
        console.error(err);
        setError(`Could not read ${file.name} — it wasn't added. Check the file and try again.`);
        continue;
      }
      const blob = new Blob([buf], { type: file.type || 'application/octet-stream' });
      setAttachments((prev) => [
        ...prev,
        {
          id: nextId++,
          name: file.name,
          size: blob.size,
          blob,
          role,
          tooBig: blob.size > MAX_FILE_BYTES,
        },
      ]);

      try {
        if (role === 'pdf') await ingestPdf(file.name, new Uint8Array(buf));
        else if (role === 'excel') await ingestExcel(file.name, new Uint8Array(buf));
      } catch (err) {
        console.error(err);
        setError(`Could not read ${file.name}. You can still enter its details by hand.`);
      }
    }
  }

  async function ingestPdf(filename: string, data: Uint8Array) {
    setBusy(`Reading ${filename}…`);
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(data);

      // Positioned text, page by page → visual lines for the fixed template.
      const items: PdfTextItem[] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        for (const it of content.items as Array<{ str?: string; transform?: number[] }>) {
          if (!it.str || !it.transform) continue;
          items.push({ str: it.str, x: it.transform[4], y: it.transform[5] });
        }
      }
      const visualLines = groupItemsIntoLines(items);

      // Merged plain text as a fallback for anything the template misses.
      const { text } = await extractText(pdf, { mergePages: true });
      const clean = (text || '').trim();
      setPdfNoText(clean.length === 0 && visualLines.length === 0);
      if (clean.length === 0 && visualLines.length === 0) return;

      const proposal = extractProposal(visualLines.length ? visualLines : clean.split(/\n+/));
      const fallback = extractHeaderFromPdfText(clean);

      // Fill only empty header fields so a prior file or manual edit isn't clobbered.
      setHeader((h) => fillEmpty(fillEmpty(h, proposal.header), fallback));
      setExtra((x) =>
        fillEmptyExtra(x, {
          customer_contact: proposal.contact,
          customer_address: proposal.address,
          notes: proposal.clientNotes,
        })
      );

      // Replace any previously imported PDF lines with this file's.
      if (proposal.lines.length) {
        setLines((prev) => [...prev.filter((l) => l.source !== 'pdf'), ...proposal.lines]);
      }

      // Auto-match to an existing quote by quote number.
      const qnum = proposal.header.quote_number || fallback.quote_number;
      if (qnum) {
        const match = existing.find((q) => (q.quote_number || '').toLowerCase() === qnum.toLowerCase());
        if (match) {
          setMode('update');
          setUpdateId(String(match.id));
        }
      }
    } finally {
      setBusy(null);
    }
  }

  async function ingestExcel(filename: string, data: Uint8Array) {
    setBusy(`Reading ${filename}…`);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(data, { type: 'array' });
      const map: Record<string, unknown[][]> = {};
      for (const name of wb.SheetNames) {
        const sheet = wb.Sheets[name];
        if (!sheet) continue;
        map[name] = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          blankrows: false,
          defval: '',
        });
      }
      sheetsRef.current = map;
      setSheetNames(wb.SheetNames);
      const first = wb.SheetNames[0] ?? '';
      // Excel always feeds Pricing Details; default to the first sheet.
      setPricingSheet(first);
      if (first) applyPricingSheet(first);
      // If Line Items are already set to come from Excel, refresh them too.
      if (lineSource === 'excel' && lineSheet) applyLineSheet(lineSheet);
    } finally {
      setBusy(null);
    }
  }

  /** Parse one worksheet into internal pricing rows, replacing prior Excel
   *  pricing rows (kept distinct from Excel line-item rows by kind). */
  function applyPricingSheet(name: string) {
    const aoa = sheetsRef.current[name];
    if (!aoa) return;
    const { lines: parsedLines, header: parsedHeader } = parseSheet(aoa, 'pricing');
    const pricing = parsedLines.map((l) => ({ ...l, kind: 'pricing' as QuoteItemKind }));
    setLines((prev) => [
      ...prev.filter((l) => !(l.source === 'excel' && l.kind === 'pricing')),
      ...pricing,
    ]);
    setHeader((h) => fillEmpty(h, parsedHeader));
    const m = extractMarkupPercent(aoa);
    if (m) setMarkup(m);
  }

  /** Parse one worksheet into customer-facing line items, replacing prior Excel
   *  line rows (kind !== 'pricing'); Excel pricing rows are left in place. */
  function applyLineSheet(name: string) {
    const aoa = sheetsRef.current[name];
    if (!aoa) return;
    const { lines: parsedLines } = parseSheet(aoa, 'display');
    const display = parsedLines.map((l) => ({ ...l, kind: 'display' as QuoteItemKind }));
    setLines((prev) => [
      ...prev.filter((l) => !(l.source === 'excel' && l.kind !== 'pricing')),
      ...display,
    ]);
  }

  function onSelectPricingSheet(name: string) {
    setPricingSheet(name);
    applyPricingSheet(name);
  }

  function onSelectLineSheet(name: string) {
    setLineSheet(name);
    applyLineSheet(name);
  }

  /** Switch where line items come from. Turning off Excel drops Excel line
   *  rows; turning it on pulls from the chosen (or first) worksheet. */
  function onChangeLineSource(next: 'pdf' | 'excel') {
    setLineSource(next);
    if (next === 'pdf') {
      setLines((prev) => prev.filter((l) => !(l.source === 'excel' && l.kind !== 'pricing')));
      return;
    }
    const target = lineSheet || sheetNames[0] || '';
    if (target) {
      setLineSheet(target);
      applyLineSheet(target);
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

  function fillEmptyExtra(current: ExtraHeader, incoming: Partial<ExtraHeader>): ExtraHeader {
    const next = { ...current };
    (Object.keys(incoming) as (keyof ExtraHeader)[]).forEach((k) => {
      const v = incoming[k];
      if (v && !next[k]) next[k] = v;
    });
    return next;
  }

  function removeAttachment(id: number) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  /* --------------------------------------------------------------- lines */

  function addLine(kind: QuoteItemKind = 'display') {
    setLines((prev) => [
      ...prev,
      { kind, description: '', quantity: '', unit: '', unit_price: '', amount: '', cost_type: '', source: 'manual' },
    ]);
  }
  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  const displayLines = lines.filter((l) => l.kind === 'display' && !isRichTextEmpty(l.description));
  const optionLines = lines.filter(
    (l) => l.kind === 'alternate' && (!isRichTextEmpty(l.description) || l.amount.trim())
  );
  const displayTotal = displayLines.reduce((s, l) => s + lineTotal(l), 0);
  const hasDisplay = displayLines.length > 0;
  const manualBid = parseNumber(header.bid_value) ?? 0;
  // Matches headlineBid() in data.ts, so the preview shows what gets saved.
  const highestOption = optionLines.length ? Math.max(...optionLines.map(lineTotal)) : 0;
  // Options are alternatives, never summed. Bid = base line total, else the
  // highest option's price, else the manual bid value.
  const effectiveBid = hasDisplay ? displayTotal : optionLines.length ? highestOption : manualBid;
  const bidLocked = hasDisplay || optionLines.length > 0;

  // Split the shared list into the two sections, keeping each row's real index
  // so the edit/remove handlers still target the right entry.
  const lineItemRows = lines.map((l, i) => ({ l, i })).filter((x) => x.l.kind !== 'pricing');
  const pricingRows = lines.map((l, i) => ({ l, i })).filter((x) => x.l.kind === 'pricing');
  const hasExcel = sheetNames.length > 0;

  // Pricing-side totals: direct costs plus markup, to sanity-check against the
  // customer-facing quote total. Display-only — never saved with the quote.
  const pricingTotal = pricingRows.reduce((s, x) => s + lineTotal(x.l), 0);
  const markupPct = parseNumber(markup) ?? 0;
  const pricingWithMarkup = pricingTotal * (1 + markupPct / 100);
  const pricingDiff = pricingWithMarkup - effectiveBid;

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
    sheetsRef.current = {};
    setSheetNames([]);
    setPricingSheet('');
    setLineSheet('');
    setLineSource('pdf');
    setMarkup('');
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
        // Pricing rows hold plain text; customer-facing rows hold rich HTML.
        .filter((l) => (l.kind === 'pricing' ? l.description.trim() : !isRichTextEmpty(l.description)))
        .map((l) => ({
          kind: l.kind,
          description: l.kind === 'pricing' ? l.description.trim() : sanitizeRichText(l.description),
          quantity: parseNumber(l.quantity) ?? 0,
          unit: l.unit.trim() || null,
          unit_price: parseNumber(l.unit_price) ?? 0,
          amount: parseNumber(l.amount),
          markup_rate: 0,
          cost_type: l.cost_type.trim() || null,
          // Imported options are single-line and ungrouped; they get named and
          // grouped the first time the quote is edited in the quote builder.
          option_group: null,
        })),
    };

    const payload = {
      mode,
      quoteId: mode === 'update' ? Number(updateId) : undefined,
      // Only meaningful when there are no display lines (options-only / header-only).
      bidValue: hasDisplay ? null : effectiveBid,
      doc,
    };

    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    // Upload the byte snapshots taken when each file was added; files over the
    // server's cap are left out (it would discard them anyway).
    const clientSkipped = attachments.filter((a) => a.tooBig).map((a) => a.name);
    for (const a of attachments) {
      if (!a.tooBig) form.append('file', a.blob, a.name);
    }

    setBusy('Saving quote…');
    try {
      const res = await fetch('/api/bulk-upload/commit', { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setError(json.error || `Save failed (HTTP ${res.status}). Please try again.`);
        return;
      }
      setResult({
        quoteId: json.quoteId,
        mode,
        attached: Array.isArray(json.attached) ? json.attached.length : 0,
        skipped: [...clientSkipped, ...(Array.isArray(json.skipped) ? json.skipped : [])],
      });
    } catch (err) {
      console.error('bulk-upload save failed', err);
      const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
      setError(
        `The save didn't reach the server${detail}. Check your internet connection and try again; ` +
          'if it keeps happening, try removing the attached files, re-adding them, and saving again.'
      );
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
            The PDF fills the header, project title, and line items; the Excel fills the
            internal pricing details (pick the worksheet in that section). Every file is
            attached. PDF · Excel/CSV · up to 10 MB each.
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
                  <span className="truncate text-brand-ink">{a.name}</span>
                  {a.tooBig && (
                    <span className="badge shrink-0 bg-red-50 text-red-700">
                      Over 10 MB — won&apos;t be attached
                    </span>
                  )}
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
          <div>
            <label className="label">Customer *</label>
            <Combobox
              options={customerOptions}
              value={customerSelValue}
              onSelect={onSelectCustomer}
              onAddNew={openAddCustomer}
              addNewLabel={(typed) => `Add “${typed}” as new customer`}
              placeholder="Search customers…"
              emptyText="No matching customers"
            />
          </div>
          <Field label="Project / Description" value={header.project_name} onChange={(v) => setHeader((h) => ({ ...h, project_name: v }))} />
          <Field label="Category" value={header.category} onChange={(v) => setHeader((h) => ({ ...h, category: v }))} />
          <div>
            <label className="label">Bid value</label>
            <input
              className="input"
              inputMode="decimal"
              value={header.bid_value}
              disabled={bidLocked}
              onChange={(e) => setHeader((h) => ({ ...h, bid_value: e.target.value }))}
              placeholder="$0"
            />
            <p className="mt-1 text-xs text-brand-gray">
              {hasDisplay
                ? `Calculated from line items: ${money(displayTotal)}`
                : optionLines.length
                  ? `From the highest option: ${money(highestOption)}`
                  : 'Used when there are no line items or options.'}
            </p>
          </div>
          <div>
            <label className="label">Issue date</label>
            <input
              className="input"
              type="date"
              value={toIsoDate(header.issue_date)}
              onChange={(e) => setHeader((h) => ({ ...h, issue_date: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Valid until</label>
            <input
              className="input"
              type="date"
              value={toIsoDate(header.valid_until)}
              onChange={(e) => setHeader((h) => ({ ...h, valid_until: e.target.value }))}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="label">Notes to client (shown on the quote)</label>
          <textarea
            className="input"
            rows={3}
            value={extra.notes}
            onChange={(e) => setExtra((x) => ({ ...x, notes: e.target.value }))}
            placeholder={
              'Work to be completed under a hard-walled ICRA Class IV containment.\nAny asbestos encountered will be the owner’s responsibility.'
            }
          />
          <p className="mt-1 text-xs text-brand-gray">
            One note per line — filled from the PDF&apos;s “Notes to Client” section when present.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowExtra((s) => !s)}
          className="mt-4 text-xs font-semibold text-brand-green-dark hover:underline"
        >
          {showExtra ? 'Hide' : 'Show'} contact fields
        </button>
        {showExtra && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Contact name" value={extra.customer_contact} onChange={(v) => setExtra((x) => ({ ...x, customer_contact: v }))} />
            <Field label="Contact email" value={extra.customer_email} onChange={(v) => setExtra((x) => ({ ...x, customer_email: v }))} />
            <Field label="Contact phone" value={extra.customer_phone} onChange={(v) => setExtra((x) => ({ ...x, customer_phone: v }))} />
            <Field label="Customer address" value={extra.customer_address} onChange={(v) => setExtra((x) => ({ ...x, customer_address: v }))} />
            <Field label="Project location" value={extra.project_location} onChange={(v) => setExtra((x) => ({ ...x, project_location: v }))} />
          </div>
        )}
      </div>

      {/* Line items — customer-facing (PDF by default, or an Excel worksheet) */}
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <label className="label mb-0">Line items</label>
          <div className="flex flex-wrap items-center gap-2 text-xs text-brand-gray">
            <span>Source</span>
            <select
              className="input !w-auto !py-1"
              value={lineSource}
              onChange={(e) => onChangeLineSource(e.target.value as 'pdf' | 'excel')}
            >
              <option value="pdf">PDF</option>
              <option value="excel">Excel worksheet</option>
            </select>
            {lineSource === 'excel' && hasExcel && (
              <select
                className="input !w-auto !py-1"
                value={lineSheet}
                onChange={(e) => onSelectLineSheet(e.target.value)}
              >
                <option value="" disabled>
                  Choose worksheet…
                </option>
                {sheetNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {lineSource === 'excel' && !hasExcel && (
          <p className="mb-3 text-xs text-brand-gray">
            Add an Excel file above, then pick which worksheet the line items come from.
          </p>
        )}

        {lineItemRows.length === 0 ? (
          <p className="text-sm text-brand-gray">
            No line items yet. Drop a PDF above, choose an Excel worksheet, or add rows
            manually.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-brand-gray">
                  <th className="pb-2 pr-2 w-28">Type</th>
                  <th className="pb-2 pr-2">Description</th>
                  <th className="pb-2 pr-2 w-28">Amount</th>
                  <th className="pb-2 pr-2 w-28">Line total</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {lineItemRows.map(({ l, i }) => (
                  <tr key={i} className="border-t border-black/5 align-top">
                    <td className="py-1.5 pr-2">
                      <select
                        className="input !py-1"
                        value={l.kind}
                        onChange={(e) => updateLine(i, { kind: e.target.value as QuoteItemKind })}
                      >
                        <option value="display">Line</option>
                        <option value="alternate">Option</option>
                      </select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <RichTextEditor
                        value={l.description}
                        onChange={(html) => updateLine(i, { description: html })}
                        placeholder="Work included — use the bullet-list button for multiple items"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input className="input !py-1" inputMode="decimal" value={l.amount} onChange={(e) => updateLine(i, { amount: e.target.value })} placeholder="0.00" />
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

        <button onClick={() => addLine('display')} className="btn-secondary mt-3 !py-1.5 text-xs">
          + Add line
        </button>

        {optionLines.length > 0 && (
          <p className="mt-3 text-xs text-brand-gray">
            {optionLines.length} option{optionLines.length === 1 ? '' : 's'} (full-price
            alternatives) — shown separately on the quote, never added into the total.
          </p>
        )}
      </div>

      {/* Pricing details — internal cost worksheet, from the Excel only */}
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <label className="label mb-0">Pricing details</label>
            <p className="mt-0.5 text-xs text-brand-gray">
              Internal cost worksheet — <span className="font-semibold">not shown on the quote</span>. Pulled from the Excel.
            </p>
          </div>
          {hasExcel && (
            <div className="flex items-center gap-2 text-xs text-brand-gray">
              <span>Worksheet</span>
              <select
                className="input !w-auto !py-1"
                value={pricingSheet}
                onChange={(e) => onSelectPricingSheet(e.target.value)}
              >
                {sheetNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {pricingRows.length === 0 ? (
          <p className="text-sm text-brand-gray">
            No pricing rows yet. Add an Excel file above, or add rows manually.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-brand-gray">
                  <th className="pb-2 pr-2">Description</th>
                  <th className="pb-2 pr-2 w-36">Cost type</th>
                  <th className="pb-2 pr-2 w-16">Qty</th>
                  <th className="pb-2 pr-2 w-16">Unit</th>
                  <th className="pb-2 pr-2 w-28">Unit price</th>
                  <th className="pb-2 pr-2 w-28">Amount</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {pricingRows.map(({ l, i }) => (
                  <tr key={i} className="border-t border-black/5 align-top">
                    <td className="py-1.5 pr-2">
                      <input className="input !py-1" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input className="input !py-1" value={l.cost_type} onChange={(e) => updateLine(i, { cost_type: e.target.value })} />
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

        <button onClick={() => addLine('pricing')} className="btn-secondary mt-3 !py-1.5 text-xs">
          + Add pricing row
        </button>

        {pricingRows.length > 0 && (
          <div className="mt-4 flex flex-col items-end gap-1.5 border-t border-black/10 pt-3 text-sm">
            <div className="flex w-80 items-center justify-between">
              <span className="text-brand-gray">Direct costs</span>
              <span className="font-medium text-brand-ink">{money(pricingTotal, { cents: true })}</span>
            </div>
            <div className="flex w-80 items-center justify-between">
              <span className="text-brand-gray">
                Markup % <span className="text-xs">(from the Estimate Summary)</span>
              </span>
              <input
                className="input !w-20 !py-1 text-right"
                inputMode="decimal"
                value={markup}
                onChange={(e) => setMarkup(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="flex w-80 items-center justify-between">
              <span className="text-brand-gray">Total with markup</span>
              <span className="font-semibold text-brand-ink">{money(pricingWithMarkup, { cents: true })}</span>
            </div>
            <div className="flex w-80 items-center justify-between">
              <span className="text-brand-gray">Quote total</span>
              <span className="font-semibold text-brand-ink">{money(effectiveBid, { cents: true })}</span>
            </div>
            {effectiveBid > 0 && (
              <p
                className={`text-xs font-medium ${
                  Math.abs(pricingDiff) < 1 ? 'text-brand-green-dark' : 'text-amber-700'
                }`}
              >
                {Math.abs(pricingDiff) < 1
                  ? 'Pricing aligns with the quote total.'
                  : `${money(Math.abs(pricingDiff), { cents: true })} ${
                      pricingDiff > 0 ? 'over' : 'under'
                    } the quote total.`}
              </p>
            )}
          </div>
        )}
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

      {/* Add-customer modal — same quick-add the quote builder uses. */}
      {addOpen && (
        <Modal open onClose={() => setAddOpen(false)} title="Add new customer">
          <div className="space-y-4">
            <div>
              <label className="label">Customer Name *</label>
              <input
                className="input"
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Sonoco Products"
                autoFocus
              />
            </div>
            <div>
              <label className="label">Customer Address</label>
              <input
                className="input"
                value={addForm.address}
                onChange={(e) => setAddForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Street, City, ST ZIP"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="label">Contact name</label>
                <input
                  className="input"
                  value={addForm.contactName}
                  onChange={(e) => setAddForm((f) => ({ ...f, contactName: e.target.value }))}
                  placeholder="Jane Doe"
                />
              </div>
              <div>
                <label className="label">Contact email</label>
                <input
                  className="input"
                  value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="jane@example.com"
                />
              </div>
              <div>
                <label className="label">Contact phone</label>
                <input
                  className="input"
                  value={addForm.phone}
                  onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="(555) 555-0123"
                />
              </div>
            </div>
            {addError && <p className="text-sm font-medium text-red-600">{addError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setAddOpen(false)} disabled={addSaving}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={confirmAddCustomer} disabled={addSaving}>
                {addSaving ? 'Saving…' : 'Add customer'}
              </button>
            </div>
          </div>
        </Modal>
      )}
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
