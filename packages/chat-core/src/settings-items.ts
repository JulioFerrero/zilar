// Each task adds exactly one row at the end of this list; `.gitattributes` merges the file with `merge=union`.
// The icon stays out of this module because Vitest cannot load `lucide-react-native`; the rendering app keeps the icon map.

export type SettingsGroup = 'account' | 'ais' | 'chats' | 'server';

export const SETTINGS_GROUP_ORDER = ['account', 'ais', 'chats', 'server'] as const;

export interface SettingsItemShape {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  href: string;
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
    id: 'routines',
    title: 'Routines',
    subtitle: 'Scheduled AI jobs you can pause or ask about.',
    icon: 'routines',
    href: '/settings/routines',
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
    id: 'folders',
    title: 'Chat folders',
    subtitle: 'Sort chats into folders.',
    icon: 'folders',
    href: '/settings/folders',
    group: 'chats',
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
    id: 'contacts',
    title: 'Contacts',
    subtitle: 'People you can chat with.',
    icon: 'contacts',
    href: '/settings/contacts',
    group: 'account',
  },
  {
    id: 'blocked',
    title: 'Blocked people',
    subtitle: 'People you blocked. They are not told.',
    icon: 'blocked',
    href: '/settings/blocked',
    group: 'account',
  },
  {
    id: 'devices',
    title: 'Devices',
    subtitle: 'Where you are signed in.',
    icon: 'devices',
    href: '/settings/devices',
    group: 'account',
  },
  {
    id: 'notifications',
    title: 'Notifications',
    subtitle: 'Push on this phone, previews and a test.',
    icon: 'notifications',
    href: '/settings/notifications',
    group: 'account',
  },
] as const satisfies readonly SettingsItemShape[];

export type SettingsItem = (typeof SETTINGS_ITEMS)[number];
export type SettingsIconId = SettingsItem['icon'];
