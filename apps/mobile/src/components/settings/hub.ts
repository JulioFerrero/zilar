import {
  SETTINGS_GROUP_ORDER,
  SETTINGS_ITEMS,
  type SettingsGroup,
  type SettingsIconId,
} from '@/lib/settings-items';

/**
 * The hub row content the settings hub renders per item: the title, the
 * subtitle, the icon test id the screen maps to a lucide component, and the
 * group whose card holds the row. Kept hook- and JSX-free so Vitest covers
 * the hub list without a simulator (the screen itself only maps rows to rows).
 */

export type { SettingsGroup };

export interface SettingsHubRow {
  id: string;
  title: string;
  subtitle: string;
  icon: SettingsIconId;
  iconTestId: string;
  href: string;
  accessibilityLabel: string;
  group: SettingsGroup;
}

/** One card of the hub: an uppercase label above its rows. */
export interface SettingsHubGroup {
  group: SettingsGroup;
  label: string;
  rows: SettingsHubRow[];
}

/** The uppercase label over each hub card. */
export const SETTINGS_GROUP_LABELS: Record<SettingsGroup, string> = {
  account: 'Account',
  ais: 'AIs and tools',
  chats: 'Chats',
  server: 'Server',
};

function toHubRow(item: (typeof SETTINGS_ITEMS)[number]): SettingsHubRow {
  return {
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    icon: item.icon,
    iconTestId: `settings-icon-${item.icon}`,
    href: item.href,
    accessibilityLabel: `${item.title}: ${item.subtitle}`,
    group: item.group,
  };
}

/** Every hub row, ordered by group and then by the registry order. */
export function settingsHubRows(): SettingsHubRow[] {
  return SETTINGS_GROUP_ORDER.flatMap((group) =>
    SETTINGS_ITEMS.filter((item) => item.group === group).map(toHubRow),
  );
}

/** The hub cards, one per group, in the group order. */
export function settingsHubGroups(): SettingsHubGroup[] {
  const rows = settingsHubRows();
  return SETTINGS_GROUP_ORDER.map((group) => ({
    group,
    label: SETTINGS_GROUP_LABELS[group],
    rows: rows.filter((row) => row.group === group),
  }));
}
