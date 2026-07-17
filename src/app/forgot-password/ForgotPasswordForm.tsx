'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { forgotPasswordAction, type ForgotPasswordState } from '@/app/actions/auth';

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ForgotPasswordState, FormData>(
    forgotPasswordAction,
    {}
  );

  if (state.sent) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-brand-green/15 px-3 py-2 text-sm text-brand-green-dark">
          If an account exists for that email, we&rsquo;ve sent a link to reset your password.
          Check your inbox — the link expires in 1 hour.
        </p>
        <Link href="/login" className="btn-secondary w-full">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          className="input"
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@dlomgroup.com"
          required
        />
      </div>
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <button className="btn-primary w-full" type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Send reset link'}
      </button>
      <Link href="/login" className="block text-center text-xs font-semibold text-brand-gray hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}
