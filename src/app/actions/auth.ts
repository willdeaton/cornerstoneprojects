'use server';

import { redirect } from 'next/navigation';
import { authenticate, createSession, destroySession } from '@/lib/auth';
import { requestPasswordReset, resetPasswordWithToken } from '@/lib/password-reset';
import { sendPasswordResetEmail } from '@/lib/email/send';
import { appOrigin } from '@/lib/app-origin';

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) {
    return { error: 'Enter your email and password.' };
  }
  const user = await authenticate(email, password);
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

/* ------------------------------------------------------- Password reset */

export interface ForgotPasswordState {
  error?: string;
  sent?: boolean;
}

/**
 * Request a password-reset link. Always reports success to the user (whether or
 * not the address is registered) so this endpoint can't be used to enumerate
 * accounts. The email is sent best-effort — a delivery/config failure is logged
 * but not surfaced.
 */
export async function forgotPasswordAction(
  _prev: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Enter your email address.' };

  try {
    const req = await requestPasswordReset(email);
    if (req) {
      const origin = await appOrigin();
      const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(req.token)}`;
      const firstName = (req.user.name || '').trim().split(/\s+/)[0] || '';
      const result = await sendPasswordResetEmail(req.user.email, firstName, resetUrl);
      if (result.status !== 'sent') {
        console.warn(`[auth] password reset email not sent: ${result.reason ?? 'unknown'}`);
      }
    }
  } catch (err) {
    // Never reveal internal state to the requester; log for operators.
    console.error('[auth] forgotPasswordAction failed:', err);
  }

  return { sent: true };
}

export interface ResetPasswordState {
  error?: string;
}

/**
 * Complete a password reset from an emailed link. On success this redirects to
 * the login screen with a confirmation flag; on failure it returns an error.
 */
export async function resetPasswordAction(
  _prev: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (!password || !confirm) return { error: 'Enter and confirm your new password.' };
  if (password !== confirm) return { error: 'Passwords do not match.' };

  const result = await resetPasswordWithToken(token, password);
  if (!result.ok) return { error: result.error };

  redirect('/login?reset=1');
}
