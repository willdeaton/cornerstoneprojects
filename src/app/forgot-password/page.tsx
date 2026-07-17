import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getBranding } from '@/lib/branding-store';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export default async function ForgotPasswordPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  const branding = await getBranding();

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={branding.full} alt="Cornerstone Facility Solutions" className="h-16 w-auto max-w-[280px] object-contain" />
        </div>
        <div className="card p-6">
          <h1 className="brand-heading mb-1 text-lg text-brand-ink">Forgot password</h1>
          <p className="mb-5 text-sm text-brand-gray">
            Enter your email and we&rsquo;ll send you a link to reset your password.
          </p>
          <ForgotPasswordForm />
        </div>
        <p className="mt-6 text-center text-xs text-white/50">
          Cornerstone Facility Solutions · DLOM Group
        </p>
      </div>
    </main>
  );
}
