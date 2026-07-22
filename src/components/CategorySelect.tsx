'use client';

import { useState } from 'react';
import { Modal } from '@/components/Modal';
import type { Category } from '@/lib/types';
import { addCategoryAction } from '@/app/actions/catalog';

/**
 * Category picker for the quote builder. Lists the saved categories and offers
 * "+ Add new category…", which persists a new category (via addCategoryAction)
 * and selects it. New categories are lifted to the parent through
 * `onCategoryAdded` so the list stays current without a reload.
 */
export function CategorySelect({
  categories,
  value,
  onChange,
  onCategoryAdded,
  className = 'input',
}: {
  categories: Category[];
  value: string;
  onChange: (name: string) => void;
  onCategoryAdded: (category: Category) => void;
  className?: string;
}) {
  const [adding, setAdding] = useState(false);

  // A value that isn't one of the saved categories (e.g. a legacy quote's
  // category) is still shown so it isn't silently lost.
  const hasValue = value !== '' && categories.some((c) => c.name === value);
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
        {categories.map((c) => (
          <option key={c.id} value={c.name}>
            {c.name}
          </option>
        ))}
        {orphan && <option value={value}>{value}</option>}
        <option value="__add__">+ Add new category…</option>
      </select>

      {adding && (
        <AddCategoryModal
          onClose={() => setAdding(false)}
          onAdded={(category) => {
            onCategoryAdded(category);
            onChange(category.name);
            setAdding(false);
          }}
        />
      )}
    </>
  );
}

function AddCategoryModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (category: Category) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const clean = name.trim();
    if (!clean) {
      setError('Enter a category.');
      return;
    }
    setError(null);
    setSaving(true);
    const res = await addCategoryAction(clean);
    if (res.ok && res.category) {
      onAdded(res.category);
    } else {
      setError(res.error ?? 'Could not add the category.');
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Add a category">
      <div className="space-y-4">
        <div>
          <label className="label">Category</label>
          <input
            className="input"
            value={name}
            autoFocus
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="e.g. Electrical, HVAC"
          />
          <p className="mt-1 text-xs text-brand-gray">
            Saved to your shared category list for future quotes.
          </p>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Adding…' : 'Add category'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
