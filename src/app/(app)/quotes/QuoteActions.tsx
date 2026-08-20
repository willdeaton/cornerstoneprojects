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
            className="menu-item font-medium"
            onClick={close}
          >
            View / PDF
          </Link>
          <Link
            href={`/quotes/${id}/edit`}
            className="menu-item"
            onClick={close}
          >
            Edit Quote
          </Link>
          {status === 'open' && (
            <button
              className="menu-item-accent"
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
              className="menu-item"
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
              className="menu-item"
              onClick={() => {
                close();
                run(() => reopenQuoteAction(id));
              }}
            >
              Reopen
            </button>
          )}
          <button
            className="menu-item-danger"
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
