'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/app/actions/auth';
import { setViewAsAction } from '@/app/actions/view-as';
import { SETTINGS_GROUPS, TIME_GROUP, itemActive, groupActive } from './nav-config';

type Role = 'admin' | 'manager' | 'worker';

interface NavUser {
  name: string;
  email: string;
  role: Role;
  /** The signed-in user's true role (differs from `role` while previewing). */
  realRole: Role;
  /** The role an admin is previewing as, or null. */
  viewingAs: Role | null;
}

type IconComp = () => React.ReactElement;
type GroupItem = { href: string; label: string; isActive: (pathname: string) => boolean };
type LinkEntry = { kind: 'link'; href: string; label: string; icon: IconComp };
type GroupEntry = { kind: 'group'; label: string; icon: IconComp; items: GroupItem[] };
type NavEntry = LinkEntry | GroupEntry;

const BASE_NAV: LinkEntry[] = [
  { kind: 'link', href: '/dashboard', label: 'Dashboard', icon: DashIcon },
  { kind: 'link', href: '/quotes', label: 'Quotes', icon: QuoteIcon },
  { kind: 'link', href: '/projects', label: 'Projects', icon: ProjectIcon },
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

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  // "Time" groups the Time Clock + Timesheets pages. Workers only have the
  // Time Clock, so for them it stays a plain link.
  const timeItems = canManageUsers
    ? TIME_GROUP.items
    : TIME_GROUP.items.filter((it) => it.href === '/time');
  const timeEntry: NavEntry =
    timeItems.length > 1
      ? {
          kind: 'group',
          label: TIME_GROUP.label,
          icon: ClockIcon,
          items: timeItems.map((it) => ({
            href: it.href,
            label: it.label,
            isActive: (p) => itemActive(it, p),
          })),
        }
      : { kind: 'link', href: '/time', label: 'Time Clock', icon: ClockIcon };

  // "Settings" opens the two page groups (System Settings / Data) as a flyout.
  const settingsEntry: GroupEntry = {
    kind: 'group',
    label: 'Settings',
    icon: SettingsIcon,
    items: SETTINGS_GROUPS.map((g) => ({
      href: g.items[0].href,
      label: g.label,
      isActive: (p) => groupActive(g, p),
    })),
  };

  const nav: NavEntry[] = [
    ...BASE_NAV,
    timeEntry,
    ...(canManageUsers ? [settingsEntry] : []),
  ];

  const NavLinks = ({ rail = false, mobile = false }: { rail?: boolean; mobile?: boolean }) => (
    <nav className="flex flex-col gap-1">
      {nav.map((entry) =>
        entry.kind === 'link' ? (
          <Link
            key={entry.href}
            href={entry.href}
            onClick={() => setOpen(false)}
            title={rail ? entry.label : undefined}
            aria-label={entry.label}
            className={`flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors ${
              rail ? 'justify-center px-0' : 'px-3'
            } ${
              isActive(entry.href)
                ? 'bg-brand-green text-white hover:bg-brand-green'
                : 'text-white hover:bg-white/10 hover:text-white'
            }`}
          >
            <entry.icon />
            {!rail && entry.label}
          </Link>
        ) : (
          <NavGroup
            key={entry.label}
            group={entry}
            rail={rail}
            mobile={mobile}
            pathname={pathname}
            onNavigate={() => setOpen(false)}
          />
        )
      )}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar (desktop) — pinned to the viewport so it stays static and
          doesn't grow with long pages; only the main content scrolls. */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto bg-black p-4 transition-[width] duration-200 lg:flex ${
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
          <NavLinks mobile />
          <div className="mt-4">
            <UserCard user={user} collapsed={false} />
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-7xl">
          {user.viewingAs && <ViewAsBanner role={user.viewingAs} />}
          {children}
        </div>
      </main>
    </div>
  );
}

/**
 * A sidebar nav entry that reveals its sub-pages. On desktop the pages fly out
 * to the right on hover; in the mobile drawer they render inline underneath.
 */
function NavGroup({
  group,
  rail,
  mobile,
  pathname,
  onNavigate,
}: {
  group: GroupEntry;
  rail: boolean;
  mobile: boolean;
  pathname: string;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = group.icon;
  const active = group.items.some((it) => it.isActive(pathname));

  if (mobile) {
    return (
      <div>
        <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-white">
          <Icon />
          {group.label}
        </div>
        <div className="ml-9 flex flex-col gap-1 border-l border-white/10 pl-2">
          {group.items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              onClick={onNavigate}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                it.isActive(pathname)
                  ? 'bg-brand-green text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              {it.label}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={rail ? group.label : undefined}
        aria-label={group.label}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`w-full flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors ${
          rail ? 'justify-center px-0' : 'px-3'
        } ${
          active
            ? 'bg-brand-green text-white hover:bg-brand-green'
            : 'text-white hover:bg-white/10 hover:text-white'
        }`}
      >
        <Icon />
        {!rail && <span className="flex-1 text-left">{group.label}</span>}
        {!rail && <ChevronRightIcon />}
      </button>
      {open && (
        // pl-2 bridges the gap so moving the pointer to the flyout keeps it open.
        <div className="absolute left-full top-0 z-30 pl-2">
          <div className="min-w-[12rem] rounded-lg border border-black/10 bg-white py-1 shadow-lg">
            {group.items.map((it) => {
              const on = it.isActive(pathname);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => {
                    setOpen(false);
                    onNavigate();
                  }}
                  className={`block px-4 py-2 text-sm transition-colors ${
                    on
                      ? 'bg-brand-green/10 font-medium text-brand-ink'
                      : 'text-brand-gray hover:bg-black/5 hover:text-brand-ink'
                  }`}
                >
                  {it.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
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
        {user.viewingAs && (
          <form action={setViewAsAction.bind(null, 'admin')}>
            <button
              title={`Viewing as ${user.viewingAs} — exit preview`}
              aria-label="Exit role preview"
              className="rounded-lg border border-amber-400/60 bg-amber-400/10 p-2 text-amber-300 transition hover:bg-amber-400/20"
            >
              <EyeIcon />
            </button>
          </form>
        )}
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
          <p className="truncate text-xs capitalize text-white/50">
            {user.role}
            {user.viewingAs && <span className="text-amber-300"> · previewing</span>}
          </p>
        </div>
      </div>

      {user.realRole === 'admin' && <ViewAsSwitcher active={user.role} />}

      <form action={logoutAction} className="mt-3">
        <button className="w-full rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10">
          Sign out
        </button>
      </form>
    </div>
  );
}

const VIEW_AS_ROLES: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'worker', label: 'Worker' },
];

/**
 * Sidebar control (admins only) to preview the app as another role. Each button
 * submits a tiny form bound to the server action, which swaps the effective role
 * cookie and reloads — so the whole app re-renders with that role's access.
 */
function ViewAsSwitcher({ active }: { active: Role }) {
  return (
    <div className="mt-3 rounded-lg border border-white/10 p-2">
      <p className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">
        <EyeIcon /> View as
      </p>
      <div className="grid grid-cols-3 gap-1">
        {VIEW_AS_ROLES.map((r) => {
          const on = r.value === active;
          return (
            <form key={r.value} action={setViewAsAction.bind(null, r.value)}>
              <button
                disabled={on}
                aria-pressed={on}
                className={`w-full rounded-md px-1 py-1.5 text-xs font-medium transition ${
                  on
                    ? 'cursor-default bg-brand-green text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                {r.label}
              </button>
            </form>
          );
        })}
      </div>
    </div>
  );
}

/** Amber banner shown across the top of every page while an admin is previewing. */
function ViewAsBanner({ role }: { role: Role }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span className="flex items-center gap-2">
        <EyeIcon />
        <span>
          You are viewing the site as a <strong className="capitalize">{role}</strong>. This shows
          exactly what that role can access.
        </span>
      </span>
      <form action={setViewAsAction.bind(null, 'admin')}>
        <button className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100">
          Exit preview
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
function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
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
function SettingsIcon() {
  return (
    <svg {...base()}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
