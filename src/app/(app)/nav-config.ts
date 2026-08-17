export type NavItem = { href: string; label: string; exact?: boolean };
export type NavGroupDef = { label: string; items: NavItem[] };

/** Sub-pages that live under the Settings section, split into flyout groups. */
export const SETTINGS_GROUPS: NavGroupDef[] = [
  {
    label: 'System Settings',
    items: [
      { href: '/settings', label: 'Company', exact: true },
      { href: '/settings/email', label: 'Email' },
      { href: '/settings/users', label: 'Users' },
    ],
  },
  {
    label: 'Data',
    items: [
      { href: '/settings/customers', label: 'Customers' },
      { href: '/settings/subcontractors', label: 'Subcontractors' },
      { href: '/settings/pricing', label: 'Pricing' },
      { href: '/settings/schedule', label: 'Non-Working Days' },
      { href: '/settings/backup', label: 'Backup' },
    ],
  },
];

/** Pages that live under the Time section. */
export const TIME_GROUP: NavGroupDef = {
  label: 'Time',
  items: [
    { href: '/time', label: 'Time Clock' },
    { href: '/timesheets', label: 'Timesheets' },
  ],
};

export function itemActive(item: NavItem, pathname: string) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + '/');
}

export function groupActive(group: NavGroupDef, pathname: string) {
  return group.items.some((it) => itemActive(it, pathname));
}
