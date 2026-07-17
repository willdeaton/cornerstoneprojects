'use client';

import { usePathname } from 'next/navigation';
import { NavTabs } from '../NavTabs';
import { SETTINGS_GROUPS, groupActive } from '../nav-config';

/**
 * Tabs for the pages within the currently-active Settings group. The group
 * itself (System Settings / Data) is chosen from the sidebar; here we just
 * show its pages as tabs.
 */
export function SettingsTabs() {
  const pathname = usePathname();
  const group = SETTINGS_GROUPS.find((g) => groupActive(g, pathname)) ?? SETTINGS_GROUPS[0];
  return <NavTabs items={group.items} />;
}
