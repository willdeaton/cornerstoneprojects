'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { UnitSelect } from '@/components/UnitSelect';
import { money } from '@/lib/format';
import type { PricingItem, Unit } from '@/lib/types';
import { savePricingItemAction, deletePricingItemAction } from '@/app/actions/catalog';

export function PricingManager({ items, units: unitsProp }: { items: PricingItem[]; units: Unit[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<{ item?: PricingItem } | null>(null);
  const [units, setUnits] = useState<Unit[]>(unitsProp);
  const [pending, start] = useTransition();

  function remove(item: PricingItem) {
    if (!confirm(`Delete "${item.description}"?`)) return;
    start(async () => {
      await deletePricingItemAction(item.id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setModal({})}>
          + Add Line Item
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-black/5 text-left text-xs uppercase tracking-wide text-brand-gray">
                <th className="px-4 py-3 font-semibold">Description</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Unit</th>
                <th className="px-4 py-3 text-right font-semibold">Unit Price</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-brand-gray">
                    No line items yet. Add one to build your price book.
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3 font-medium text-brand-ink">{it.description}</td>
                    <td className="px-4 py-3 text-brand-gray">{it.category ?? '—'}</td>
                    <td className="px-4 py-3 text-brand-gray">{it.unit ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-brand-ink whitespace-nowrap">
                      {money(it.unit_price, { cents: true })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          className="rounded p-1 px-2 text-brand-gray hover:bg-black/5"
                          onClick={() => setModal({ item: it })}
                        >
                          Edit
                        </button>
                        <button
                          className="rounded p-1 px-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
                          onClick={() => remove(it)}
                          disabled={pending}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <PricingFormModal
          item={modal.item}
          units={units}
          onUnitAdded={(u) => setUnits((us) => [...us, u])}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function PricingFormModal({
  item,
  units,
  onUnitAdded,
  onClose,
  onSaved,
}: {
  item?: PricingItem;
  units: Unit[];
  onUnitAdded: (unit: Unit) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [unit, setUnit] = useState(item?.unit ?? 'ea');
  const [unitPrice, setUnitPrice] = useState(item ? String(item.unit_price) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError(null);
    setSaving(true);
    const price = parseFloat(unitPrice.replace(/[$,\s]/g, ''));
    const res = await savePricingItemAction({
      id: item?.id,
      description,
      unit,
      unit_price: isNaN(price) ? 0 : price,
      category,
    });
    if (res.ok) onSaved();
    else {
      setError(res.error ?? 'Could not save.');
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={item ? 'Edit Line Item' : 'Add Line Item'}>
      <div className="space-y-4">
        <div>
          <label className="label">Description *</label>
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Carpet tile — furnish & install"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Category</label>
            <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Flooring" />
          </div>
          <div>
            <label className="label">Unit</label>
            <UnitSelect units={units} value={unit} onChange={setUnit} onUnitAdded={onUnitAdded} />
          </div>
          <div>
            <label className="label">Unit Price</label>
            <input
              className="input"
              inputMode="decimal"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder="0.00"
            />
          </div>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
