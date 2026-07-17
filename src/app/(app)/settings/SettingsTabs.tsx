'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/settings', label: 'Company' },
  { href: '/settings/customers', label: 'Customers' },
  { href: '/settings/pricing', label: 'Pricing' },
  { href: '/settings/email', label: 'Email' },
  { href: '/settings/users', label: 'Users' },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b border-black/10">
      {TABS.map(({ href, label }) => {
        const active = href === '/settings' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? 'border-brand-green text-brand-ink'
                : 'border-transparent text-brand-gray hover:text-brand-ink'
            }`}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
