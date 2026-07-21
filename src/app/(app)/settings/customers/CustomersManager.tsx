'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import type { CustomerWithContacts, CustomerContact } from '@/lib/types';
import {
  saveCustomerAction,
  deleteCustomerAction,
  saveContactAction,
  deleteContactAction,
} from '@/app/actions/catalog';

type CustomerModal = { mode: 'new' } | { mode: 'edit'; customer: CustomerWithContacts } | null;
type ContactModal =
  | { customerId: number; contact?: CustomerContact; customerName: string }
  | null;

export function CustomersManager({ customers }: { customers: CustomerWithContacts[] }) {
  const router = useRouter();
  const [customerModal, setCustomerModal] = useState<CustomerModal>(null);
  const [contactModal, setContactModal] = useState<ContactModal>(null);
  const [pending, start] = useTransition();

  function removeCustomer(c: CustomerWithContacts) {
    if (!confirm(`Delete "${c.name}" and its ${c.contacts.length} contact(s)? This can't be undone.`)) return;
    start(async () => {
      await deleteCustomerAction(c.id);
      router.refresh();
    });
  }

  function removeContact(ct: CustomerContact) {
    if (!confirm(`Delete contact "${ct.name}"?`)) return;
    start(async () => {
      await deleteContactAction(ct.id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setCustomerModal({ mode: 'new' })}>
          + Add Customer
        </button>
      </div>

      {customers.length === 0 ? (
        <div className="card p-8 text-center text-sm text-brand-gray">
          No customers yet. Add one to start building your customer list.
        </div>
      ) : (
        <div className="space-y-3">
          {customers.map((c) => (
            <div key={c.id} className="card p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="font-semibold text-brand-ink">{c.name}</h3>
                  <div className="mt-1 space-y-0.5 text-sm text-brand-gray">
                    {c.address && <p className="whitespace-pre-line">{c.address}</p>}
                    {c.notes && <p className="italic">{c.notes}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    className="btn-secondary"
                    onClick={() => setCustomerModal({ mode: 'edit', customer: c })}
                  >
                    Edit
                  </button>
                  <button
                    className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    onClick={() => removeCustomer(c)}
                    disabled={pending}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Contacts */}
              <div className="mt-4 border-t border-black/5 pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
                    Contacts
                  </span>
                  <button
                    className="text-sm font-medium text-brand-green-dark hover:underline"
                    onClick={() => setContactModal({ customerId: c.id, customerName: c.name })}
                  >
                    + Add Contact
                  </button>
                </div>
                {c.contacts.length === 0 ? (
                  <p className="text-sm text-brand-gray">No contacts yet.</p>
                ) : (
                  <ul className="divide-y divide-black/5">
                    {c.contacts.map((ct) => (
                      <li key={ct.id} className="flex items-center justify-between py-2 text-sm">
                        <div className="min-w-0">
                          <span className="font-medium text-brand-ink">{ct.name}</span>
                          {ct.title && <span className="text-brand-gray"> — {ct.title}</span>}
                          <div className="text-brand-gray">
                            {ct.email}
                            {ct.email && ct.phone ? ' · ' : ''}
                            {ct.phone}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button
                            className="rounded p-1 text-brand-gray hover:bg-black/5"
                            onClick={() =>
                              setContactModal({ customerId: c.id, contact: ct, customerName: c.name })
                            }
                          >
                            Edit
                          </button>
                          <button
                            className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
                            onClick={() => removeContact(ct)}
                            disabled={pending}
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {customerModal && (
        <CustomerFormModal
          customer={customerModal.mode === 'edit' ? customerModal.customer : undefined}
          onClose={() => setCustomerModal(null)}
          onSaved={() => {
            setCustomerModal(null);
            router.refresh();
          }}
        />
      )}

      {contactModal && (
        <ContactFormModal
          customerId={contactModal.customerId}
          customerName={contactModal.customerName}
          contact={contactModal.contact}
          onClose={() => setContactModal(null)}
          onSaved={() => {
            setContactModal(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- Customer form */

function CustomerFormModal({
  customer,
  onClose,
  onSaved,
}: {
  customer?: CustomerWithContacts;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(customer?.name ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError(null);
    setSaving(true);
    const res = await saveCustomerAction({
      id: customer?.id,
      name,
      address,
      notes,
    });
    if (res.ok) onSaved();
    else {
      setError(res.error ?? 'Could not save.');
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={customer ? 'Edit Customer' : 'Add Customer'}>
      <div className="space-y-4">
        <div>
          <label className="label">Customer Name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ARH-Highlands" />
        </div>
        <div>
          <label className="label">Address</label>
          <textarea
            className="input min-h-[72px] resize-y"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={'Street, Suite\nCity, ST ZIP'}
          />
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input resize-y" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional internal notes" />
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

/* -------------------------------------------------------------- Contact form */

function ContactFormModal({
  customerId,
  customerName,
  contact,
  onClose,
  onSaved,
}: {
  customerId: number;
  customerName: string;
  contact?: CustomerContact;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(contact?.name ?? '');
  const [title, setTitle] = useState(contact?.title ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError(null);
    setSaving(true);
    const res = await saveContactAction({
      id: contact?.id,
      customer_id: customerId,
      name,
      title,
      email,
      phone,
    });
    if (res.ok) onSaved();
    else {
      setError(res.error ?? 'Could not save.');
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`${contact ? 'Edit' : 'Add'} Contact — ${customerName}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Name *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div>
            <label className="label">Title</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Facilities Director" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-0123" />
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
