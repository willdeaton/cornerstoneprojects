'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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
  logoSrc,
  iconSrc,
  children,
}: {
  user: NavUser;
  clockedInTo: { project: string; customer: string } | null;
  logoSrc: string;
  iconSrc: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(false); // desktop rail

  // Restore the desktop collapsed preference after mount (avoids hydration
  // mismatch — the server always renders the expanded sidebar).
  useEffect(() => {
    if (localStorage.getItem('sidebar-collapsed') === '1') setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem('sidebar-collapsed', next ? '1' : '0');
      return next;
    });
  }

  const canManageUsers = user.role === 'admin' || user.role === 'manager';
  const nav = canManageUsers
    ? [
        ...NAV,
        { href: '/timesheets', label: 'Timesheets', icon: TimesheetIcon },
        { href: '/settings', label: 'Settings', icon: SettingsIcon },
      ]
    : NAV;

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const NavLinks = ({ rail = false }: { rail?: boolean }) => (
    <nav className="flex flex-col gap-1">
      {nav.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={() => setOpen(false)}
          title={rail ? label : undefined}
          aria-label={label}
          className={`flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors ${
            rail ? 'justify-center px-0' : 'px-3'
          } ${
            isActive(href)
              ? 'bg-brand-green text-white hover:bg-brand-green'
              : 'text-white hover:bg-white/10 hover:text-white'
          }`}
        >
          <Icon />
          {!rail && label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar (desktop) */}
      <aside
        className={`hidden shrink-0 flex-col bg-black p-4 transition-[width] duration-200 lg:flex ${
          collapsed ? 'w-20' : 'w-64'
        }`}
      >
        {/* Logo + collapse toggle */}
        <div
          className={`mb-6 flex pt-1 ${
            collapsed ? 'flex-col items-center gap-3' : 'items-center justify-between gap-2 px-2'
          }`}
        >
          {collapsed ? (
            <IconMark iconSrc={iconSrc} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoSrc} alt="Company logo" className="h-12 w-auto max-w-[180px] object-contain" />
          )}
          <button
            onClick={toggleCollapsed}
            className="rounded-lg p-2 text-white hover:bg-white/10"
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
          >
            <HamburgerIcon />
          </button>
        </div>

        <NavLinks rail={collapsed} />

        <div className="mt-auto space-y-3 pt-4">
          {clockedInTo &&
            (collapsed ? (
              <Link
                href="/time"
                title={`Clocked in — ${clockedInTo.project}`}
                className="flex justify-center rounded-lg border border-brand-green/40 bg-brand-green/10 p-2"
              >
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand-green" />
              </Link>
            ) : (
              <Link
                href="/time"
                className="block rounded-lg border border-brand-green/40 bg-brand-green/10 px-3 py-2 text-xs text-brand-green-light"
              >
                <span className="flex items-center gap-1.5 font-semibold">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-brand-green" /> Clocked in
                </span>
                <span className="mt-0.5 block truncate text-white/60">{clockedInTo.project}</span>
              </Link>
            ))}
          <UserCard user={user} collapsed={collapsed} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between bg-black px-4 py-3 lg:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} alt="Company logo" className="h-9 w-auto max-w-[150px] object-contain" />
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg p-2 text-white hover:bg-white/10"
          aria-label="Menu"
        >
          <HamburgerIcon />
        </button>
      </header>
      {open && (
        <div className="bg-black px-4 pb-4 lg:hidden">
          <NavLinks />
          <div className="mt-4">
            <UserCard user={user} collapsed={false} />
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

/** Square mark for the collapsed rail: the uploaded icon, else a brand "C". */
function IconMark({ iconSrc }: { iconSrc: string | null }) {
  if (iconSrc) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={iconSrc} alt="Company icon" className="h-10 w-10 rounded-lg object-contain" />;
  }
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green text-lg font-bold text-white">
      C
    </div>
  );
}

function UserCard({ user, collapsed }: { user: NavUser; collapsed: boolean }) {
  const initials = user.name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2">
        <div
          title={user.name}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-green text-sm font-bold text-white"
        >
          {initials}
        </div>
        <form action={logoutAction}>
          <button
            title="Sign out"
            aria-label="Sign out"
            className="rounded-lg p-2 text-white/80 transition hover:bg-white/10"
          >
            <SignOutIcon />
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-white/5 p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-green text-sm font-bold text-white">
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
function base() {
  return {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    // Always inherit the link's text color so icons stay white in every state.
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}
function HamburgerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
    </svg>
  );
}
function SignOutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
function DashIcon() {
  return (
    <svg {...base()}>
      <rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" />
    </svg>
  );
}
function QuoteIcon() {
  return (
    <svg {...base()}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}
function ProjectIcon() {
  return (
    <svg {...base()}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg {...base()}>
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}
function TimesheetIcon() {
  return (
    <svg {...base()}>
      <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" />
      <path d="M8 14l2.5 2.5L15 12" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg {...base()}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
