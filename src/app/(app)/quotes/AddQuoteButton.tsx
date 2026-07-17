'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { createQuoteAction } from '@/app/actions/quotes';

export function AddQuoteButton() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function submit(fd: FormData) {
    setSaving(true);
    await createQuoteAction(fd);
    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>
        + Add Quote
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add Quote">
        <form action={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Quote #</label>
              <input name="quote_number" className="input" placeholder="e.g. Q-2601" />
            </div>
            <div>
              <label className="label">Date Received</label>
              <input name="date_received" type="date" className="input" />
            </div>
          </div>
          <div>
            <label className="label">Customer *</label>
            <input name="customer" className="input" required placeholder="e.g. ARH-Highlands" />
          </div>
          <div>
            <label className="label">Project / Description</label>
            <input name="project_name" className="input" placeholder="Scope of work" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Category</label>
              <input name="category" className="input" placeholder="Flooring" list="categories" />
              <datalist id="categories">
                <option value="Flooring" />
                <option value="Painting" />
                <option value="Renovation" />
                <option value="Roofing" />
                <option value="Restoration" />
                <option value="Maintenance" />
                <option value="Janitorial" />
                <option value="Grounds" />
              </datalist>
            </div>
            <div>
              <label className="label">Bid Value *</label>
              <input name="bid_value" className="input" required inputMode="decimal" placeholder="25000" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Add Quote'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
