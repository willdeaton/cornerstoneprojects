'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { money } from '@/lib/format';
import { RECEIPT_CATEGORIES, type ReceiptWithItems } from '@/lib/types';
import { downscaleImage } from '@/lib/image-downscale';
import { saveReceiptAction, type ReceiptFormState } from '@/app/actions/receipts';
import {
  ReceiptLineItems,
  blankItemRow,
  toItemRows,
  type ItemRow,
} from './ReceiptLineItems';

/**
 * Today, as the phone sees it.
 *
 * 'en-CA' formats as YYYY-MM-DD, which is what a date input wants, and it comes
 * off the local clock — so the default is the day the person holding the receipt
 * is actually having, not a UTC day that might already be tomorrow.
 */
function today(): string {
  return new Date().toLocaleDateString('en-CA');
}

function num(v: string): number {
  const n = parseFloat(v.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

interface Picked {
  file: File;
  thumb: File | null;
  previewUrl: string | null;
}

/**
 * Add or edit one receipt: the photo, what it says, and what was on it.
 *
 * `initialFile` is how the camera-first flow works — the photo is taken on the
 * tab, then handed straight in here so the form opens with the receipt already
 * on screen to read the figures off.
 */
export function ReceiptForm({
  projectId,
  receipt,
  initialFile,
  onClose,
}: {
  projectId: number;
  receipt: ReceiptWithItems | null;
  initialFile: File | null;
  onClose: () => void;
}) {
  const [state, action, saving] = useActionState<ReceiptFormState, FormData>(
    saveReceiptAction,
    {}
  );
  const router = useRouter();
  const imageRef = useRef<HTMLInputElement>(null);
  const thumbRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  const [picked, setPicked] = useState<Picked | null>(null);
  const [shrinking, setShrinking] = useState(false);
  // Only meaningful on an edit: drop the photo already on the receipt.
  const [removeExisting, setRemoveExisting] = useState(false);

  const [vendor, setVendor] = useState(receipt?.vendor ?? '');
  const [purchaseDate, setPurchaseDate] = useState(receipt?.purchase_date ?? today());
  const [category, setCategory] = useState<string>(receipt?.category ?? 'Material');
  const [subtotal, setSubtotal] = useState(receipt?.subtotal ? String(receipt.subtotal) : '');
  const [tax, setTax] = useState(receipt?.tax ? String(receipt.tax) : '');
  const [total, setTotal] = useState(receipt?.total ? String(receipt.total) : '');
  const [note, setNote] = useState(receipt?.note ?? '');
  const [rows, setRows] = useState<ItemRow[]>(
    receipt ? toItemRows(receipt.items) : [blankItemRow()]
  );

  // Shrink and attach whatever the camera or the picker handed over. Done on
  // pick rather than on submit so the preview IS the image that gets stored —
  // no surprise between what was reviewed and what was saved.
  const attach = useCallback(async (file: File) => {
    setShrinking(true);
    try {
      const { file: shrunk, thumb } = await downscaleImage(file);
      setPicked((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return {
          file: shrunk,
          thumb,
          previewUrl: shrunk.type.startsWith('image/') ? URL.createObjectURL(shrunk) : null,
        };
      });
      setRemoveExisting(false);
    } finally {
      setShrinking(false);
    }
  }, []);

  // The photo taken on the tab, before this form existed.
  useEffect(() => {
    if (initialFile) void attach(initialFile);
  }, [initialFile, attach]);

  // Hand the shrunk files to the real form inputs. A File in React state is not
  // in the form; assigning a DataTransfer's FileList is the same move the Files
  // tab already makes for drag-and-drop.
  useEffect(() => {
    const put = (input: HTMLInputElement | null, file: File | null) => {
      if (!input) return;
      const dt = new DataTransfer();
      if (file) dt.items.add(file);
      input.files = dt.files;
    };
    put(imageRef.current, picked?.file ?? null);
    put(thumbRef.current, picked?.thumb ?? null);
  }, [picked]);

  // Revoke the last preview when the form goes away.
  useEffect(() => {
    return () => {
      if (picked?.previewUrl) URL.revokeObjectURL(picked.previewUrl);
    };
  }, [picked]);

  // Close on success. Depends on the whole state object — a fresh reference per
  // dispatch — so saving two receipts in a row closes both times.
  useEffect(() => {
    if (state.success) {
      router.refresh();
      // Hold the modal open when the photo was rejected, so the message is read.
      if (!state.error) onClose();
    }
  }, [state, router, onClose]);

  const hasExistingImage = !!receipt?.image_filename && !removeExisting;
  const showingImage = !!picked || hasExistingImage;
  const subtotalNum = num(subtotal);
  const taxNum = num(tax);
  const totalNum = num(total);
  const mismatch =
    totalNum > 0 &&
    (subtotalNum > 0 || taxNum > 0) &&
    Math.abs(subtotalNum + taxNum - totalNum) > 0.01;

  function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so choosing the same file again still fires a change event.
    e.target.value = '';
    if (file) void attach(file);
  }

  return (
    <Modal open wide onClose={onClose} title={receipt ? 'Edit receipt' : 'Add receipt'}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="receipt_id" value={receipt?.id ?? ''} />
        <input type="hidden" name="remove_image" value={removeExisting ? '1' : ''} />
        {/* The shrunk photo and its thumbnail, filled in by the effect above. */}
        <input ref={imageRef} type="file" name="image" className="hidden" />
        <input ref={thumbRef} type="file" name="image_thumb" className="hidden" />

        {/* -------------------------------------------------- the photo itself */}
        <div className="rounded-xl border border-surface-line bg-black/[0.02] p-3">
          <div className="flex items-start gap-3">
            <div className="flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-surface-line bg-white">
              {shrinking ? (
                <span className="text-[0.65rem] text-brand-gray">Shrinking…</span>
              ) : picked?.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={picked.previewUrl} alt="" className="h-full w-full object-cover" />
              ) : picked ? (
                <span className="eyebrow">PDF</span>
              ) : hasExistingImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/receipts/${receipt!.id}/image?size=thumb`}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-center text-[0.65rem] leading-tight text-brand-gray">
                  No photo
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  className="btn-primary"
                  disabled={shrinking}
                >
                  Take photo
                </button>
                <button
                  type="button"
                  onClick={() => pickerRef.current?.click()}
                  className="btn-secondary"
                  disabled={shrinking}
                >
                  Choose file
                </button>
                {showingImage && (
                  <button
                    type="button"
                    onClick={() => {
                      setPicked((prev) => {
                        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
                        return null;
                      });
                      // Only an existing photo needs the server told about it.
                      if (receipt?.image_filename) setRemoveExisting(true);
                    }}
                    className="text-sm font-medium text-red-500 transition hover:underline"
                  >
                    Remove photo
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-brand-gray">
                {picked
                  ? `Attached · ${(picked.file.size / 1024).toFixed(0)} KB`
                  : hasExistingImage
                    ? receipt!.image_filename
                    : 'Optional — a vendor and a total is enough on its own.'}
              </p>
            </div>
          </div>

          {/*
            Two inputs, not one. With `capture` set, iOS and Android open the
            camera directly and offer no way to reach the photo library — so a
            single input cannot serve both "snap it now" and "attach the one I
            already have". On desktop `capture` is ignored and this is a normal
            file picker, which is the right behaviour there anyway.
          */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onPicked}
          />
          <input
            ref={pickerRef}
            type="file"
            accept="image/*,application/pdf,.pdf"
            className="hidden"
            onChange={onPicked}
          />
        </div>

        {/* ------------------------------------------------ what it says */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="eyebrow mb-1 block">Vendor</span>
            <input
              className="input"
              name="vendor"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="e.g. Home Depot"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="eyebrow mb-1 block">Purchase date</span>
            <input
              className="input"
              type="date"
              name="purchase_date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="eyebrow mb-1 block">Category</span>
            <select
              className="input"
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {RECEIPT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {/* inputMode="decimal" gives phones the numeric keypad while still
              accepting a pasted "$1,234.56" — parseMoney strips the rest. */}
          <label className="block">
            <span className="eyebrow mb-1 block">Subtotal</span>
            <input
              className="input tnum text-right"
              inputMode="decimal"
              name="subtotal"
              value={subtotal}
              onChange={(e) => setSubtotal(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="block">
            <span className="eyebrow mb-1 block">Tax</span>
            <input
              className="input tnum text-right"
              inputMode="decimal"
              name="tax"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="block">
            <span className="eyebrow mb-1 block">Total</span>
            <input
              className="input tnum text-right font-semibold"
              inputMode="decimal"
              name="total"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              placeholder="0.00"
            />
          </label>
        </div>

        {/* Flagged before the save as well as after it, so it can be fixed
            while the paper is still in hand. Never blocks the save. */}
        {mismatch && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Subtotal + tax is {money(subtotalNum + taxNum, { cents: true })}, but the total says{' '}
            {money(totalNum, { cents: true })}. The total is what gets counted.
          </p>
        )}

        <ReceiptLineItems rows={rows} onChange={setRows} />

        <label className="block">
          <span className="eyebrow mb-1 block">Note</span>
          <input
            className="input"
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional — what it was for"
          />
        </label>

        {state.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
        )}
        {state.warning && !state.error && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{state.warning}</p>
        )}

        <div className="flex justify-end gap-2 border-t border-surface-line pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || shrinking}>
            {saving ? 'Saving…' : receipt ? 'Save changes' : 'Save receipt'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
