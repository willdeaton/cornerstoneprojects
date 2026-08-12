'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import type { Subcontractor } from '@/lib/types';
import { saveSubcontractorAction, deleteSubcontractorAction } from '@/app/actions/schedule';

type SubModal = { mode: 'new' } | { mode: 'edit'; sub: Subcontractor } | null;

export function SubcontractorsManager({ subs }: { subs: Subcontractor[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<SubModal>(null);
  const [pending, start] = useTransition();

  function remove(s: Subcontractor) {
    if (
      !confirm(
        `Delete "${s.name}"? Any scheduled work assigned to them will lose that assignment.`
      )
    )
      return;
    start(async () => {
      await deleteSubcontractorAction(s.id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setModal({ mode: 'new' })}>
          + Add Subcontractor
        </button>
      </div>

      {subs.length === 0 ? (
        <div className="card p-8 text-center text-sm text-brand-gray">
          No subcontractors yet. Add one so you can schedule them onto a job.
        </div>
      ) : (
        <div className="space-y-3">
          {subs.map((s) => (
            <div key={s.id} className="card p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="flex flex-wrap items-center gap-2 font-semibold text-brand-ink">
                    {s.name}
                    {s.trade && (
                      <span className="badge bg-brand-green/15 text-brand-green-dark">{s.trade}</span>
                    )}
                    {!s.active && <span className="badge bg-gray-100 text-gray-600">Inactive</span>}
                  </h3>
                  <div className="mt-1 space-y-0.5 text-sm text-brand-gray">
                    {s.contact_name && <p>{s.contact_name}</p>}
                    {(s.email || s.phone) && (
                      <p>
                        {s.email}
                        {s.email && s.phone ? ' · ' : ''}
                        {s.phone}
                      </p>
                    )}
                    {!s.email && (
                      <p className="text-amber-700">
                        No email — they won&apos;t receive the schedule by email.
                      </p>
                    )}
                    {s.notes && <p className="italic">{s.notes}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button className="btn-secondary" onClick={() => setModal({ mode: 'edit', sub: s })}>
                    Edit
                  </button>
                  <button
                    className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    onClick={() => remove(s)}
                    disabled={pending}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <SubcontractorFormModal
          sub={modal.mode === 'edit' ? modal.sub : undefined}
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

function SubcontractorFormModal({
  sub,
  onClose,
  onSaved,
}: {
  sub?: Subcontractor;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(sub?.name ?? '');
  const [trade, setTrade] = useState(sub?.trade ?? '');
  const [contactName, setContactName] = useState(sub?.contact_name ?? '');
  const [email, setEmail] = useState(sub?.email ?? '');
  const [phone, setPhone] = useState(sub?.phone ?? '');
  const [notes, setNotes] = useState(sub?.notes ?? '');
  const [active, setActive] = useState(sub?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError(null);
    setSaving(true);
    const res = await saveSubcontractorAction({
      id: sub?.id,
      name,
      trade,
      contact_name: contactName,
      email,
      phone,
      notes,
      active,
    });
    if (res.ok) onSaved();
    else {
      setError(res.error ?? 'Could not save.');
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={sub ? 'Edit Subcontractor' : 'Add Subcontractor'}>
      <div className="space-y-4">
        <div>
          <label className="label">Company Name *</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Valley Drywall"
          />
        </div>
        <div>
          <label className="label">Trade</label>
          <input
            className="input"
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            placeholder="Drywall"
          />
        </div>
        <div>
          <label className="label">Contact Person</label>
          <input
            className="input"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Dave Miller"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="dave@valleydrywall.com"
            />
          </div>
          <div>
            <label className="label">Phone</label>
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-0142"
            />
          </div>
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea
            className="input resize-y"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional internal notes"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-brand-ink">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active — show in the schedule pickers
        </label>
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
