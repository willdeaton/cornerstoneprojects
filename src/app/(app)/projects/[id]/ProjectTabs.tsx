'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ProjectTab } from './project-tabs';
import { tabHref } from './project-tabs';

/**
 * Tab strip for one job. Matches the underlined strip the Settings and Time
 * sections use, but the active test is by path segment rather than by prefix:
 * every tab's href starts with the overview's, so a prefix match would light
 * the overview up on every tab.
 */
export function ProjectTabs({
  projectId,
  tabs,
}: {
  projectId: number;
  tabs: ProjectTab[];
}) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  // '' on the overview, 'billing' on /projects/12/billing.
  const current = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, '') : '';

  return (
    <div className="no-scrollbar mb-6 flex gap-1 overflow-x-auto border-b border-surface-line">
      {tabs.map((tab) => {
        const active = current === tab.segment;
        return (
          <Link
            key={tab.segment || 'overview'}
            href={tabHref(projectId, tab)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-[color,border-color] duration-150 ease-out ${
              active
                ? 'border-brand-green font-semibold text-brand-ink'
                : 'border-transparent font-medium text-brand-gray hover:border-surface-line-strong hover:text-brand-ink'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
