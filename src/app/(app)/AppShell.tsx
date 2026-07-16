'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/app/actions/auth';

interface NavUser {
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'worker';
}

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: DashIcon },
  { href: '/quotes', label: 'Open Quotes', icon: QuoteIcon },
  { href: '/projects', label: 'Active Projects', icon: ProjectIcon },
  { href: '/time', label: 'Time Clock', icon: ClockIcon },
];

export function AppShell({
  user,
  clockedInTo,
  children,
}: {
  user: NavUser;
  clockedInTo: { project: string; customer: string } | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const canManageUsers = user.role === 'admin' || user.role === 'manager';
  const nav = canManageUsers ? [...NAV, { href: '/users', label: 'Users', icon: UsersIcon }] : NAV;

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const NavLinks = () => (
    <nav className="flex flex-col gap-1">
      {nav.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={() => setOpen(false)}
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            isActive(href)
              ? 'bg-brand-green/15 text-brand-ink'
              : 'text-white/70 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Icon active={isActive(href)} />
          {label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 flex-col bg-brand-ink p-4 lg:flex">
        <div className="mb-6 px-2 pt-2">
          <Image src="/logo-onblack.png" alt="Cornerstone" width={200} height={47} priority />
        </div>
        <NavLinks />
        <div className="mt-auto space-y-3 pt-4">
          {clockedInTo && (
            <Link
              href="/time"
              className="block rounded-lg border border-brand-green/40 bg-brand-green/10 px-3 py-2 text-xs text-brand-green-light"
            >
              <span className="flex items-center gap-1.5 font-semibold">
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand-green" /> Clocked in
              </span>
              <span className="mt-0.5 block truncate text-white/60">{clockedInTo.project}</span>
            </Link>
          )}
          <UserCard user={user} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between bg-brand-ink px-4 py-3 lg:hidden">
        <Image src="/logo-onblack.png" alt="Cornerstone" width={150} height={35} />
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg p-2 text-white hover:bg-white/10"
          aria-label="Menu"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      {open && (
        <div className="bg-brand-ink px-4 pb-4 lg:hidden">
          <NavLinks />
          <div className="mt-4">
            <UserCard user={user} />
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}

function UserCard({ user }: { user: NavUser }) {
  const initials = user.name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className="rounded-lg bg-white/5 p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-green text-sm font-bold text-brand-ink">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{user.name}</p>
          <p className="truncate text-xs capitalize text-white/50">{user.role}</p>
        </div>
      </div>
      <form action={logoutAction} className="mt-3">
        <button className="w-full rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10">
          Sign out
        </button>
      </form>
    </div>
  );
}

/* --- inline icons (no external deps) --- */
function base(active?: boolean) {
  return {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: active ? '#98C73A' : 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}
function DashIcon({ active }: { active?: boolean }) {
  return (
    <svg {...base(active)}>
      <rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" />
    </svg>
  );
}
function QuoteIcon({ active }: { active?: boolean }) {
  return (
    <svg {...base(active)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}
function ProjectIcon({ active }: { active?: boolean }) {
  return (
    <svg {...base(active)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
function ClockIcon({ active }: { active?: boolean }) {
  return (
    <svg {...base(active)}>
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}
function UsersIcon({ active }: { active?: boolean }) {
  return (
    <svg {...base(active)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
