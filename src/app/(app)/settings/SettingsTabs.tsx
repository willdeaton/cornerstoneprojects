'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Item = { href: string; label: string };
type Menu = { label: string; items: Item[] };

const MENUS: Menu[] = [
  {
    label: 'System Settings',
    items: [
      { href: '/settings', label: 'Company' },
      { href: '/settings/email', label: 'Email' },
      { href: '/settings/users', label: 'Users' },
    ],
  },
  {
    label: 'Data',
    items: [
      { href: '/settings/customers', label: 'Customers' },
      { href: '/settings/pricing', label: 'Pricing' },
    ],
  },
];

function isActive(href: string, pathname: string) {
  return href === '/settings' ? pathname === href : pathname.startsWith(href);
}

function SettingsMenu({ menu, pathname }: { menu: Menu; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close when clicking outside the menu.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const groupActive = menu.items.some((it) => isActive(it.href, pathname));
  const current = menu.items.find((it) => isActive(it.href, pathname));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
          groupActive
            ? 'border-brand-green text-brand-ink'
            : 'border-black/10 text-brand-gray hover:text-brand-ink'
        }`}
      >
        <span>{menu.label}</span>
        {current && <span className="text-xs text-brand-gray">· {current.label}</span>}
        <span className="text-xs">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 min-w-[12rem] rounded-lg border border-black/10 bg-white py-1 shadow-lg">
          {menu.items.map((it) => {
            const active = isActive(it.href, pathname);
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={() => setOpen(false)}
                className={`block px-4 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-brand-green/10 font-medium text-brand-ink'
                    : 'text-brand-gray hover:bg-black/5 hover:text-brand-ink'
                }`}
              >
                {it.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-6 flex flex-wrap gap-2 border-b border-black/10 pb-3">
      {MENUS.map((menu) => (
        <SettingsMenu key={menu.label} menu={menu} pathname={pathname} />
      ))}
    </div>
  );
}
