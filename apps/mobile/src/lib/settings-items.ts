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

/** The hub card a row belongs to; the hub renders one card per group. */
export type SettingsGroup = 'account' | 'ais' | 'chats' | 'server';

/** The order the hub renders the group cards in. */
export const SETTINGS_GROUP_ORDER = ['account', 'ais', 'chats', 'server'] as const;

export interface SettingsItemShape {
  id: string;
  title: string;
  subtitle: string;
  /** Names an entry of `HUB_ICONS`; the screen maps it to a lucide icon. */
  icon: string;
  /** The expo-router route pushed when the row is tapped. */
  href: string;
  /** Which card of the hub renders this row. */
  group: SettingsGroup;
}

export const SETTINGS_ITEMS = [
  {
    id: 'profile',
    title: 'Profile',
    subtitle: 'Your name, picture and @username.',
    icon: 'profile',
    href: '/settings/profile',
    group: 'account',
  },
  {
    id: 'requests',
    title: 'Contact requests',
    subtitle: 'People who asked to connect, and your own requests.',
    icon: 'requests',
    href: '/settings/requests',
    group: 'account',
  },
  {
    id: 'approvals',
    title: 'Approvals',
    subtitle: 'Pending requests and always-allowed rules.',
    icon: 'approvals',
    href: '/settings/approvals',
    group: 'ais',
  },
  {
    id: 'machines',
    title: 'Machines',
    subtitle: 'Computers where your AIs can work.',
    icon: 'machines',
    href: '/settings/machines',
    group: 'ais',
  },
  {
    id: 'connections',
    title: 'Connections',
    subtitle: 'Provider accounts for your AIs.',
    icon: 'connections',
    href: '/settings/connections',
    group: 'ais',
  },
  {
    id: 'integrations',
    title: 'Integrations',
    subtitle: 'Telegram, email and transcription for this server.',
    icon: 'integrations',
    href: '/settings/integrations',
    group: 'server',
  },
  {
    id: 'stickers',
    title: 'Stickers',
    subtitle: 'Your packs, shared packs and favorites.',
    icon: 'stickers',
    href: '/settings/stickers',
    group: 'chats',
  },
  {
    id: 'blocked',
    title: 'Blocked people',
    subtitle: 'People you blocked. They are not told.',
    icon: 'blocked',
    href: '/settings/blocked',
    group: 'account',
  },
] as const satisfies readonly SettingsItemShape[];

export type SettingsItem = (typeof SETTINGS_ITEMS)[number];
export type SettingsIconId = SettingsItem['icon'];
