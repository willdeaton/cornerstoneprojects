'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { importQuotesAction, type ParsedQuote } from '@/app/actions/quotes';
import { money } from '@/lib/format';

type Phase = 'select' | 'preview' | 'importing' | 'done';

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
              quotes. We&apos;ll match columns for <em>Customer</em>, <em>Project</em>,{' '}
              <em>Category</em> and <em>Bid Value</em> automatically.
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
            <div className="max-h-72 overflow-auto rounded-lg border border-black/10">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase text-brand-gray">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Customer</th>
                    <th className="px-3 py-2 font-semibold">Project</th>
                    <th className="px-3 py-2 font-semibold">Category</th>
                    <th className="px-3 py-2 text-right font-semibold">Bid Value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-black/5">
                      <td className="px-3 py-2 font-medium text-brand-ink">{r.customer || '—'}</td>
                      <td className="px-3 py-2 text-brand-gray">{r.project_name || '—'}</td>
                      <td className="px-3 py-2 text-brand-gray">{r.category || '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-brand-ink">
                        {money(r.bid_value || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
