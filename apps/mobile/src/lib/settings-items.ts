/**
 * The rows the settings hub shows. Each task in the mobile parity roadmap
 * adds exactly one row to this list when it adds a settings page, and one
 * entry to `HUB_ICONS` in `app/settings/index.tsx` (Vitest cannot load
 * `lucide-react-native`, so the icon itself stays out of this module).
 *
 * The icon id and the route types come FROM the rows, so a new row never
 * edits a union type. `.gitattributes` merges this file with `merge=union`:
 * two tasks that each append a row merge without a conflict. Keep one row per
 * block, and append at the end.
 */

export interface SettingsItemShape {
  id: string;
  title: string;
  subtitle: string;
  /** Names an entry of `HUB_ICONS`; the screen maps it to a lucide icon. */
  icon: string;
  /** The expo-router route pushed when the row is tapped. */
  href: string;
}

export const SETTINGS_ITEMS = [
  {
    id: 'profile',
    title: 'Profile',
    subtitle: 'Your name, picture and @username.',
    icon: 'profile',
    href: '/settings/profile',
  },
  {
    id: 'ais',
    title: 'My AIs',
    subtitle: 'Your AIs, their model and their spending limits.',
    icon: 'ai',
    href: '/ais',
  },
  {
    id: 'requests',
    title: 'Contact requests',
    subtitle: 'People who asked to connect, and your own requests.',
    icon: 'requests',
    href: '/settings/requests',
  },
  {
    id: 'approvals',
    title: 'Approvals',
    subtitle: 'Pending requests and always-allowed rules.',
    icon: 'approvals',
    href: '/settings/approvals',
  },
] as const satisfies readonly SettingsItemShape[];

export type SettingsItem = (typeof SETTINGS_ITEMS)[number];
export type SettingsIconId = SettingsItem['icon'];
export interface SettingsItem {
  icon: 'UserPlus' | 'Server' | 'KeyRound';
  label: string;
  href: '/settings/requests' | '/settings/machines' | '/settings/connections';
}

export const SETTINGS_ITEMS: readonly SettingsItem[] = [
  { icon: 'UserPlus', label: 'Contact requests', href: '/settings/requests' },
  // T-0185: mirrors web's Settings → Machines and Connections. Web guards
  // both pages with `RequireAuth` only (any signed-in user manages their
  // own machines and keys), so no `ownerOnly` flag is needed here.
  { icon: 'Server', label: 'Machines', href: '/settings/machines' },
  { icon: 'KeyRound', label: 'Connections', href: '/settings/connections' },
];
