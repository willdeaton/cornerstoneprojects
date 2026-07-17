'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { loginAction, type LoginState } from '@/app/actions/auth';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});

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
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="label mb-0" htmlFor="password">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="text-xs font-semibold text-brand-green-dark hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <button className="btn-primary w-full" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign In'}
      </button>
    </form>
  );
}
