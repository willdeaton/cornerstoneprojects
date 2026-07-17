'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { itemActive, type NavItem } from './nav-config';

/** Underlined tab strip used for the sub-pages of a nav section. */
export function NavTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b border-black/10">
      {items.map((it) => {
        const active = itemActive(it, pathname);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              active
                ? 'border-brand-green text-brand-ink'
                : 'border-transparent text-brand-gray hover:text-brand-ink'
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}
