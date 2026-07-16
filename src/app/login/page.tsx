import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getLogo } from '@/lib/data';
import { LoginForm } from './LoginForm';

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');
  const logoSrc = getLogo() ?? '/logo-onblack.png';

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt="Cornerstone Facility Solutions" className="h-16 w-auto max-w-[280px] object-contain" />
        </div>
        <div className="card p-6">
          <h1 className="brand-heading mb-1 text-lg text-brand-ink">Project Tracker</h1>
          <p className="mb-5 text-sm text-brand-gray">Sign in to continue.</p>
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-xs text-white/50">
          Cornerstone Facility Solutions · DLOM Group
        </p>
      </div>
    </main>
  );
}
