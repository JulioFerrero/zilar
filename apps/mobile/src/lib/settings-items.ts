/**
 * The settings hub rows (T-0181 owns this file; T-0182 adds the contact
 * requests row). Each row is an icon name from `lucide-react-native`, a
 * label, and the route it opens.
 */

export interface SettingsItem {
  icon: 'UserPlus';
  label: string;
  href: '/settings/requests';
}

export const SETTINGS_ITEMS: readonly SettingsItem[] = [
  { icon: 'UserPlus', label: 'Contact requests', href: '/settings/requests' },
];
