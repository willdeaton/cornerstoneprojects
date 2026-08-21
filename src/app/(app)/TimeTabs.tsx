'use client';

import { NavTabs } from './NavTabs';
import { TIME_GROUP } from './nav-config';

/**
 * Tabs for the Time section (Time Clock / Timesheets). Timesheets is only
 * available to managers/admins, so employees with a single page see no tabs.
 */
export function TimeTabs({ canManage }: { canManage: boolean }) {
  const items = canManage
    ? TIME_GROUP.items
    : TIME_GROUP.items.filter((it) => it.href === '/time');
  if (items.length < 2) return null;
  return <NavTabs items={items} />;
}
