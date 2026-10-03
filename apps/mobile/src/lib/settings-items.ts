/**
 * The rows the settings hub shows. Each task in the mobile parity roadmap
 * adds exactly one row here when it adds a settings page (created by
 * T-0181); the hub in `app/settings/index.tsx` renders them, mapping the
 * icon id to a lucide component at the screen (Vitest cannot load
 * `lucide-react-native`, so the icon itself stays out of this module).
 */

export type SettingsIconId = 'profile' | 'ai' | 'requests' | 'approvals';

export interface SettingsItem {
  id: string;
  title: string;
  subtitle: string;
  icon: SettingsIconId;
  /** The expo-router route pushed when the row is tapped. */
  href: '/settings/profile' | '/ais' | '/settings/requests' | '/settings/approvals';
}

export const SETTINGS_ITEMS: readonly SettingsItem[] = [
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
];
