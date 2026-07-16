'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { QuoteStatus } from '@/lib/types';
import {
  convertQuoteAction,
  markQuoteLostAction,
  reopenQuoteAction,
  deleteQuoteAction,
} from '@/app/actions/quotes';

export function QuoteActions({ id, status }: { id: number; status: QuoteStatus }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setOpen(false);
    await fn();
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button
        className="rounded-lg px-2 py-1 text-brand-gray hover:bg-black/5 disabled:opacity-50"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-label="Actions"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-lg border border-black/10 bg-white py-1 text-sm shadow-card-hover">
          {status === 'open' && (
            <button
              className="block w-full px-4 py-2 text-left font-medium text-brand-green-dark hover:bg-brand-green/10"
              onClick={() => run(() => convertQuoteAction(id))}
            >
              Mark Sold → Project
            </button>
          )}
          {status === 'open' && (
            <button
              className="block w-full px-4 py-2 text-left text-brand-ink hover:bg-black/5"
              onClick={() => run(() => markQuoteLostAction(id))}
            >
              Mark Lost
            </button>
          )}
          {status !== 'open' && (
            <button
              className="block w-full px-4 py-2 text-left text-brand-ink hover:bg-black/5"
              onClick={() => run(() => reopenQuoteAction(id))}
            >
              Reopen
            </button>
          )}
          <button
            className="block w-full px-4 py-2 text-left text-red-600 hover:bg-red-50"
            onClick={() => {
              if (confirm('Delete this quote? This cannot be undone.')) run(() => deleteQuoteAction(id));
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
