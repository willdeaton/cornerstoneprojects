'use client';

import { useState, useEffect, useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { createUserAction, type UserFormState } from '@/app/actions/users';
import { SubscriptionFields } from './SubscriptionFields';

export function AddUserButton({
  canGrantAdmin,
  managers,
}: {
  canGrantAdmin: boolean;
  managers: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<UserFormState, FormData>(createUserAction, {});
  const router = useRouter();

  useEffect(() => {
    if (state.success) router.refresh();
  }, [state.success, router]);

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>
        + Add User
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add User">
        <form action={action} className="space-y-4">
          <div>
            <label className="label">Full Name</label>
            <input name="name" className="input" required placeholder="Jane Foreman" />
          </div>
          <div>
            <label className="label">Email</label>
            <input name="email" type="email" className="input" required placeholder="jane@dlomgroup.com" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Temp Password</label>
              <input name="password" className="input" required minLength={6} placeholder="min 6 chars" />
            </div>
            <div>
              <label className="label">Role</label>
              <select name="role" className="input" defaultValue="employee">
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                {canGrantAdmin && <option value="admin">Admin</option>}
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Manager</label>
              <select name="manager_id" className="input" defaultValue="">
                <option value="">— No manager —</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-brand-gray">
                Who this user reports to. Used for weekly time approvals.
              </p>
            </div>
            <div>
              <label className="label">Hourly rate ($/hr)</label>
              <input
                name="hourly_rate"
                className="input"
                inputMode="decimal"
                placeholder="e.g. 22.50 (optional)"
              />
            </div>
          </div>
          <p className="text-xs text-brand-gray">
            Employees can only use the time clock and see the work they&apos;re booked on.
            Managers &amp; admins get the rest of the tracker and can manage users.
          </p>
          <div className="border-t border-black/5 pt-4">
            <SubscriptionFields />
          </div>
          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}
          {state.success && (
            <p className="rounded-lg bg-brand-green/15 px-3 py-2 text-sm text-brand-green-dark">
              {state.success} You can add another or close.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Close
            </button>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? 'Adding…' : 'Add User'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
