'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/ui';
import { money } from '@/lib/format';
import type { ReceiptWithItems } from '@/lib/types';
import { receiptsTotal } from '@/lib/receipt-math';
import { deleteReceiptAction } from '@/app/actions/receipts';
import { ReceiptsTable } from './ReceiptsTable';
import { ReceiptForm } from './ReceiptForm';

/**
 * The Receipts tab.
 *
 * Camera-first on purpose: the common case is standing at a counter with the
 * paper in one hand, so "Take photo" is the primary button and it opens the
 * form with the receipt already on screen to read the figures off. Typing a
 * receipt with no photo at all is the other supported path, not a lesser one —
 * plenty of costs are known after the paper is gone.
 */
export function ProjectReceipts({
  projectId,
  receipts,
}: {
  projectId: number;
  receipts: ReceiptWithItems[];
}) {
  const router = useRouter();
  const [deleting, startDelete] = useTransition();
  const cameraRef = useRef<HTMLInputElement>(null);

  // `null` means closed. Open carries the receipt being edited (or null for a
  // new one) plus any photo the camera button just produced.
  const [editing, setEditing] = useState<{
    receipt: ReceiptWithItems | null;
    file: File | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = receiptsTotal(receipts);

  function remove(receipt: ReceiptWithItems) {
    const what = receipt.vendor
      ? `${receipt.vendor} — ${money(receipt.total, { cents: true })}`
      : money(receipt.total, { cents: true });
    if (!confirm(`Delete the receipt for ${what}? This cannot be undone.`)) return;
    startDelete(async () => {
      const res = await deleteReceiptAction(receipt.id, projectId);
      if (res.error) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="brand-heading text-sm text-brand-gray">
            Receipts <span className="text-brand-gray/70">({receipts.length})</span>
          </h2>
          {receipts.length > 0 && (
            <p className="tnum mt-0.5 text-lg font-bold text-brand-ink">
              {money(total, { cents: true })} spent on this job
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() => cameraRef.current?.click()}
          >
            Take photo
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setEditing({ receipt: null, file: null })}
          >
            Add receipt
          </button>
        </div>

        {/*
          capture="environment" opens the rear camera directly on iOS and
          Android. The picked file is handed to the form rather than uploaded
          here, so the figures get typed while the photo is on screen.
        */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            // Reset so the same photo can be picked twice in a row.
            e.target.value = '';
            if (file) setEditing({ receipt: null, file });
          }}
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {receipts.length === 0 ? (
        <EmptyState
          title="No receipts on this job yet"
          hint="Take a photo of a receipt, then type what's on it — vendor, date and total is enough."
        />
      ) : (
        <ReceiptsTable
          receipts={receipts}
          onEdit={(receipt) => setEditing({ receipt, file: null })}
          onDelete={remove}
          deleting={deleting}
        />
      )}

      {editing && (
        <ReceiptForm
          projectId={projectId}
          receipt={editing.receipt}
          initialFile={editing.file}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
