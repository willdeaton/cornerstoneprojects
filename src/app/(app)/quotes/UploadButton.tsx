'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { importQuotesAction, type ParsedQuote } from '@/app/actions/quotes';
import { money } from '@/lib/format';

type Phase = 'select' | 'preview' | 'importing' | 'done';

/** Best-effort plain text from a line-item description (imports are plain, but
 * be safe against any stray markup). */
function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function UploadButton() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('select');
  const [rows, setRows] = useState<ParsedQuote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [importedCount, setImportedCount] = useState(0);
  const router = useRouter();

  function reset() {
    setPhase('select');
    setRows([]);
    setError(null);
    setFileName('');
    setImportedCount(0);
  }

  function close() {
    setOpen(false);
    setTimeout(reset, 200);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/quotes/parse', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not read that file.');
      return;
    }
    if (!data.rows?.length) {
      setError('No quotes found in that file.');
      return;
    }
    setRows(data.rows);
    setPhase('preview');
  }

  async function doImport() {
    setPhase('importing');
    const res = await importQuotesAction(rows);
    setImportedCount(res?.imported ?? rows.length);
    setPhase('done');
    router.refresh();
  }

  const total = rows.reduce((s, r) => s + (r.bid_value || 0), 0);

  return (
    <>
      <button className="btn-secondary" onClick={() => setOpen(true)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Upload Excel
      </button>

      <Modal open={open} onClose={close} title="Upload Weekly Quotes" wide>
        {phase === 'select' && (
          <div className="space-y-4">
            <p className="text-sm text-brand-gray">
              Upload an <strong>.xlsx</strong> or <strong>.csv</strong> file of this week&apos;s new
              quotes. We&apos;ll match columns for <em>Quote Number</em>, <em>Customer</em>,{' '}
              <em>Project</em>, <em>Category</em>, <em>Date Received</em> and <em>Notes</em>{' '}
              automatically. Add <em>Item Type</em>, <em>Item Description</em>, <em>Qty</em>,{' '}
              <em>Unit</em>, <em>Unit Price</em> and <em>Amount</em> columns to import{' '}
              <strong>line items and pricing details</strong> — rows that share a Quote Number roll
              up into one quote.
            </p>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-black/15 bg-black/[0.02] px-6 py-10 text-center transition hover:border-brand-green hover:bg-brand-green/5">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#98C73A" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-sm font-semibold text-brand-ink">Choose a file</span>
              <span className="text-xs text-brand-gray">or drag it here</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={onFile}
              />
            </label>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <p className="text-center text-xs text-brand-gray">
              Not sure of the format?{' '}
              <a href="/api/quotes/template" className="font-semibold text-brand-green-dark underline">
                Download the template
              </a>
            </p>
          </div>
        )}

        {phase === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-brand-gray">
                <span className="font-semibold text-brand-ink">{rows.length}</span> quotes found in{' '}
                <span className="font-medium">{fileName}</span> · Total{' '}
                <span className="font-semibold text-brand-ink">{money(total)}</span>
              </p>
              <button className="text-xs font-semibold text-brand-gray underline" onClick={reset}>
                Choose another file
              </button>
            </div>
            <div className="max-h-96 space-y-3 overflow-auto pr-1">
              {rows.map((r, i) => {
                const items = r.items ?? [];
                const displayItems = items.filter((it) => it.kind === 'display');
                const pricingItems = items.filter((it) => it.kind === 'pricing');
                return (
                  <div key={i} className="rounded-lg border border-black/10">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 bg-gray-50 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-brand-ink">
                          {r.customer || '—'}
                          {r.quote_number ? (
                            <span className="ml-2 text-xs font-normal text-brand-gray">
                              {r.quote_number}
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-brand-gray">
                          {[r.project_name, r.category, r.date_received]
                            .filter(Boolean)
                            .join(' · ') || 'No project details'}
                        </p>
                      </div>
                      <span className="font-semibold text-brand-ink">{money(r.bid_value || 0)}</span>
                    </div>

                    {items.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-brand-gray">
                        No line items — imports as a single pipeline quote.
                      </p>
                    ) : (
                      <div className="space-y-2 px-3 py-2 text-sm">
                        {displayItems.length > 0 && (
                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-brand-gray">
                              Line Items
                            </p>
                            {displayItems.map((it, j) => (
                              <div key={j} className="flex justify-between gap-3 py-0.5">
                                <span className="min-w-0 flex-1 truncate text-brand-ink">
                                  {stripHtml(it.description)}
                                </span>
                                <span className="whitespace-nowrap font-medium text-brand-ink">
                                  {money(
                                    it.amount != null ? it.amount : it.quantity * it.unit_price,
                                    { cents: true },
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {pricingItems.length > 0 && (
                          <div className="rounded-md bg-black/[0.02] p-2">
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-brand-gray">
                              Pricing Worksheet <span className="font-normal">(internal)</span>
                            </p>
                            {pricingItems.map((it, j) => (
                              <div key={j} className="flex justify-between gap-3 py-0.5 text-xs text-brand-gray">
                                <span className="min-w-0 flex-1 truncate">
                                  {stripHtml(it.description)}
                                </span>
                                <span className="whitespace-nowrap">
                                  {it.quantity} {it.unit ?? ''} × {money(it.unit_price, { cents: true })}
                                  {' = '}
                                  <span className="font-medium text-brand-ink">
                                    {money(it.quantity * it.unit_price, { cents: true })}
                                  </span>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={close}>
                Cancel
              </button>
              <button className="btn-primary" onClick={doImport}>
                Import {rows.length} Quotes
              </button>
            </div>
          </div>
        )}

        {phase === 'importing' && (
          <p className="py-8 text-center text-sm text-brand-gray">Importing…</p>
        )}

        {phase === 'done' && (
          <div className="space-y-4 py-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-green/20">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7BA82C" strokeWidth="2.5">
                <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="font-semibold text-brand-ink">
              Imported {importedCount} quote{importedCount === 1 ? '' : 's'}
            </p>
            <button className="btn-primary mx-auto" onClick={close}>
              Done
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}
