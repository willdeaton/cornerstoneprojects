'use client';

import { useState, useEffect, useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { createUserAction, type UserFormState } from '@/app/actions/users';
import { SubscriptionFields } from './SubscriptionFields';

export function AddUserButton({ canGrantAdmin }: { canGrantAdmin: boolean }) {
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Temp Password</label>
              <input name="password" className="input" required minLength={6} placeholder="min 6 chars" />
            </div>
            <div>
              <label className="label">Role</label>
              <select name="role" className="input" defaultValue="worker">
                <option value="worker">Worker</option>
                <option value="manager">Manager</option>
                {canGrantAdmin && <option value="admin">Admin</option>}
              </select>
            </div>
          </div>
          <p className="text-xs text-brand-gray">
            Workers can clock in/out and add notes. Managers &amp; admins can also manage users.
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
