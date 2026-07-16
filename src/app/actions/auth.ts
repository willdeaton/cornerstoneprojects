'use server';

import { redirect } from 'next/navigation';
import { authenticate, createSession, destroySession } from '@/lib/auth';

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) {
    return { error: 'Enter your email and password.' };
  }
  const user = authenticate(email, password);
  if (!user) {
    return { error: 'Incorrect email or password.' };
  }
  await createSession(user.id);
  redirect('/dashboard');
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/login');
}
