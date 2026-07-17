'use client';

import { useActionState } from 'react';
import { resetPasswordAction, type ResetPasswordState } from '@/app/actions/auth';

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ResetPasswordState, FormData>(
    resetPasswordAction,
    {}
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label" htmlFor="password">
          New password
        </label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={6}
          placeholder="At least 6 characters"
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="confirm">
          Confirm new password
        </label>
        <input
          className="input"
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={6}
          required
        />
      </div>
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <button className="btn-primary w-full" type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Reset password'}
      </button>
    </form>
  );
}
