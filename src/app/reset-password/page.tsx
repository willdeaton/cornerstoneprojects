import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getBranding } from '@/lib/branding-store';
import { ResetPasswordForm } from './ResetPasswordForm';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  const { token } = await searchParams;
  const branding = await getBranding();

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={branding.full} alt="Cornerstone Facility Solutions" className="h-16 w-auto max-w-[280px] object-contain" />
        </div>
        <div className="card p-6">
          <h1 className="brand-heading mb-1 text-lg text-brand-ink">Reset password</h1>
          {token ? (
            <>
              <p className="mb-5 text-sm text-brand-gray">Choose a new password for your account.</p>
              <ResetPasswordForm token={token} />
            </>
          ) : (
            <>
              <p className="mb-5 text-sm text-brand-gray">
                This reset link is missing or invalid. Request a new one to continue.
              </p>
              <Link href="/forgot-password" className="btn-primary w-full">
                Request a new link
              </Link>
            </>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-white/50">
          Cornerstone Facility Solutions · DLOM Group
        </p>
      </div>
    </main>
  );
}
