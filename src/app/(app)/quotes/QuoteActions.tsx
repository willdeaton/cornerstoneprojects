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
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  /**
   * Actions that can refuse report it back. The menu only offers what the
   * quote's current status allows, but a list open in two tabs can be a status
   * behind — so a refusal is shown rather than swallowed, and the refresh that
   * follows brings the row's real options back.
   */
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (res && typeof res === 'object' && 'error' in res) {
      setError(String((res as { error: string }).error));
    }
    router.refresh();
  }

  return (
    <>
      {error && (
        <p className="mb-1 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      )}
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
    </>
  );
}
