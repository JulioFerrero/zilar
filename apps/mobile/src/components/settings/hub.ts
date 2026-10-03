import { SETTINGS_ITEMS, type SettingsIconId } from '@/lib/settings-items';

/**
 * The hub row content the settings hub renders per item: the title, the
 * subtitle, and the icon test id the screen maps to a lucide component.
 * Kept hook- and JSX-free so Vitest covers the hub list without a
 * simulator (the screen itself only maps rows to rows).
 */

export interface SettingsHubRow {
  id: string;
  title: string;
  subtitle: string;
  icon: SettingsIconId;
  iconTestId: string;
  href: string;
  accessibilityLabel: string;
}

export function settingsHubRows(): SettingsHubRow[] {
  return SETTINGS_ITEMS.map((item) => ({
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    icon: item.icon,
    iconTestId: `settings-icon-${item.icon}`,
    href: item.href,
    accessibilityLabel: `${item.title}: ${item.subtitle}`,
  }));
}
