'use client';

import { useState, useRef, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@/lib/auth';
import type { UserRow } from '@/lib/data';
import { Modal } from '@/components/Modal';
import { changeRoleAction, toggleActiveAction, resetPasswordAction } from '@/app/actions/users';

export function UserRowActions({
  user,
  isSelf,
  canGrantAdmin,
}: {
  user: UserRow;
  isSelf: boolean;
  canGrantAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const roles: Role[] = canGrantAdmin ? ['worker', 'manager', 'admin'] : ['worker', 'manager'];

  function run(fn: () => Promise<unknown>) {
    start(async () => {
      await fn();
      setOpen(false);
      router.refresh();
    });
  }

  function submitPw() {
    start(async () => {
      const res = await resetPasswordAction(user.id, pw);
      if (res && !res.ok) {
        setMsg(res.error ?? 'Could not reset password.');
      } else {
        setPwOpen(false);
        setPw('');
        setMsg(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button
        className="rounded-lg px-2 py-1 text-brand-gray hover:bg-black/5 disabled:opacity-50"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-label="Actions"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-lg border border-black/10 bg-white py-1 text-sm shadow-card-hover">
          <p className="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-brand-gray">
            Set role
          </p>
          {roles.map((r) => (
            <button
              key={r}
              disabled={r === user.role}
              className="block w-full px-4 py-1.5 text-left capitalize text-brand-ink hover:bg-black/5 disabled:font-semibold disabled:text-brand-green-dark"
              onClick={() => run(() => changeRoleAction(user.id, r))}
            >
              {r}
              {r === user.role ? ' ✓' : ''}
            </button>
          ))}
          <div className="my-1 border-t border-black/5" />
          <button
            className="block w-full px-4 py-1.5 text-left text-brand-ink hover:bg-black/5"
            onClick={() => {
              setOpen(false);
              setPwOpen(true);
            }}
          >
            Reset password
          </button>
          {!isSelf &&
            (user.active ? (
              <button
                className="block w-full px-4 py-1.5 text-left text-red-600 hover:bg-red-50"
                onClick={() => run(() => toggleActiveAction(user.id, false))}
              >
                Deactivate
              </button>
            ) : (
              <button
                className="block w-full px-4 py-1.5 text-left text-brand-green-dark hover:bg-brand-green/10"
                onClick={() => run(() => toggleActiveAction(user.id, true))}
              >
                Reactivate
              </button>
            ))}
        </div>
      )}

      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title={`Reset password — ${user.name}`}>
        <div className="space-y-4">
          <div>
            <label className="label">New Password</label>
            <input
              className="input"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="min 6 characters"
              autoFocus
            />
          </div>
          <p className="text-xs text-brand-gray">
            The user will be signed out of any active sessions and must use the new password.
          </p>
          {msg && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setPwOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={submitPw} disabled={pending || pw.length < 6}>
              {pending ? 'Saving…' : 'Set Password'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
