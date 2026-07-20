'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { QuoteStatus } from '@/lib/types';
import { DropdownMenu } from '@/components/DropdownMenu';
import {
  convertQuoteAction,
  markQuoteLostAction,
  reopenQuoteAction,
  deleteQuoteAction,
} from '@/app/actions/quotes';

export function QuoteActions({ id, status }: { id: number; status: QuoteStatus }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    await fn();
    setBusy(false);
    router.refresh();
  }

  return (
    <DropdownMenu width={176} disabled={busy}>
      {(close) => (
        <>
          <Link
            href={`/quotes/${id}/print`}
            className="block w-full px-4 py-2 text-left font-medium text-brand-ink hover:bg-black/5"
            onClick={close}
          >
            View / PDF
          </Link>
          <Link
            href={`/quotes/${id}/edit`}
            className="block w-full px-4 py-2 text-left text-brand-ink hover:bg-black/5"
            onClick={close}
          >
            Edit Quote
          </Link>
          {status === 'open' && (
            <button
              className="block w-full px-4 py-2 text-left font-medium text-brand-green-dark hover:bg-brand-green/10"
              onClick={() => {
                close();
                run(() => convertQuoteAction(id));
              }}
            >
              Mark Sold → Project
            </button>
          )}
          {status === 'open' && (
            <button
              className="block w-full px-4 py-2 text-left text-brand-ink hover:bg-black/5"
              onClick={() => {
                close();
                run(() => markQuoteLostAction(id));
              }}
            >
              Mark Lost
            </button>
          )}
          {status !== 'open' && (
            <button
              className="block w-full px-4 py-2 text-left text-brand-ink hover:bg-black/5"
              onClick={() => {
                close();
                run(() => reopenQuoteAction(id));
              }}
            >
              Reopen
            </button>
          )}
          <button
            className="block w-full px-4 py-2 text-left text-red-600 hover:bg-red-50"
            onClick={() => {
              close();
              if (confirm('Delete this quote? This cannot be undone.')) run(() => deleteQuoteAction(id));
            }}
          >
            Delete
          </button>
        </>
      )}
    </DropdownMenu>
  );
}
