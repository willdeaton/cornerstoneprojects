'use client';

import { useState } from 'react';
import { Modal } from '@/components/Modal';
import type { Unit } from '@/lib/types';
import { addUnitAction } from '@/app/actions/catalog';

/**
 * Unit-of-measure picker shared by the quote pricing worksheet and the price
 * book form. Lists the saved units and offers "+ Add new unit…", which persists
 * a new unit (via addUnitAction) and selects it. New units are lifted to the
 * parent through `onUnitAdded` so every row's dropdown sees them immediately.
 */
export function UnitSelect({
  units,
  value,
  onChange,
  onUnitAdded,
  className = 'input',
}: {
  units: Unit[];
  value: string;
  onChange: (label: string) => void;
  onUnitAdded: (unit: Unit) => void;
  className?: string;
}) {
  const [adding, setAdding] = useState(false);

  // A value that isn't one of the saved units (e.g. a legacy quote's unit) is
  // still shown so it isn't silently lost.
  const hasValue = value !== '' && units.some((u) => u.label === value);
  const orphan = value !== '' && !hasValue;

  return (
    <>
      <select
        className={className}
        value={value}
        onChange={(e) => {
          if (e.target.value === '__add__') setAdding(true);
          else onChange(e.target.value);
        }}
      >
        <option value="">—</option>
        {units.map((u) => (
          <option key={u.id} value={u.label}>
            {u.label}
          </option>
        ))}
        {orphan && <option value={value}>{value}</option>}
        <option value="__add__">+ Add new unit…</option>
      </select>

      {adding && (
        <AddUnitModal
          onClose={() => setAdding(false)}
          onAdded={(unit) => {
            onUnitAdded(unit);
            onChange(unit.label);
            setAdding(false);
          }}
        />
      )}
    </>
  );
}

function AddUnitModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (unit: Unit) => void;
}) {
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const clean = label.trim();
    if (!clean) {
      setError('Enter a unit.');
      return;
    }
    setError(null);
    setSaving(true);
    const res = await addUnitAction(clean);
    if (res.ok && res.unit) {
      onAdded(res.unit);
    } else {
      setError(res.error ?? 'Could not add the unit.');
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Add a unit">
      <div className="space-y-4">
        <div>
          <label className="label">Unit</label>
          <input
            className="input"
            value={label}
            autoFocus
            maxLength={16}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="e.g. cs, box, roll"
          />
          <p className="mt-1 text-xs text-brand-gray">
            Saved to your shared unit list for future quotes and price-book items.
          </p>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Adding…' : 'Add unit'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
