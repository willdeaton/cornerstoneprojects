'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { itemActive, type NavItem } from './nav-config';

/** Underlined tab strip used for the sub-pages of a nav section. */
export function NavTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <div className="no-scrollbar mb-6 flex gap-1 overflow-x-auto border-b border-surface-line">
      {items.map((it) => {
        const active = itemActive(it, pathname);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-[color,border-color] duration-150 ease-out ${
              active
                ? 'border-brand-green font-semibold text-brand-ink'
                : 'border-transparent font-medium text-brand-gray hover:border-surface-line-strong hover:text-brand-ink'
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}
