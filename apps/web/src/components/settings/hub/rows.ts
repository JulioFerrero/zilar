import {
  Ban,
  Bell,
  FolderOpen,
  KeyRound,
  MonitorSmartphone,
  Plug,
  Repeat,
  Server,
  ShieldCheck,
  Sticker,
  UserPlus,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  SETTINGS_GROUP_ORDER,
  SETTINGS_ITEMS,
  type SettingsGroup,
  type SettingsIconId,
  type SettingsItem,
} from '@zilar/chat-core';

/**
 * The `/settings/<page>` routes the web app serves today. The shared list is
 * the source of truth for both apps; a row whose page web does not have is
 * hidden instead of becoming a dead link.
 */
const WEB_SETTINGS_HREFS: ReadonlySet<string> = new Set([
  '/settings/profile',
  '/settings/requests',
  '/settings/contacts',
  '/settings/blocked',
  '/settings/devices',
  '/settings/notifications',
  '/settings/approvals',
  '/settings/routines',
  '/settings/machines',
  '/settings/connections',
  '/settings/integrations',
  '/settings/stickers',
  '/settings/folders',
]);

export const SETTINGS_HUB_ICONS: Record<SettingsIconId, LucideIcon> = {
  profile: UserRound,
  requests: UserPlus,
  contacts: Users,
  blocked: Ban,
  devices: MonitorSmartphone,
  approvals: ShieldCheck,
  routines: Repeat,
  machines: Server,
  connections: KeyRound,
  integrations: Plug,
  stickers: Sticker,
  folders: FolderOpen,
  notifications: Bell,
};

const SETTINGS_GROUP_LABELS: Record<SettingsGroup, string> = {
  account: 'Account',
  ais: 'AIs and tools',
  chats: 'Chats',
  server: 'Server',
};

export interface WebSettingsGroup {
  group: SettingsGroup;
  label: string;
  rows: SettingsItem[];
}

function rowsFor(group: SettingsGroup): SettingsItem[] {
  return SETTINGS_ITEMS.filter((item) => item.group === group && WEB_SETTINGS_HREFS.has(item.href));
}

export function webSettingsGroups(): WebSettingsGroup[] {
  return SETTINGS_GROUP_ORDER.map((group) => ({
    group,
    label: SETTINGS_GROUP_LABELS[group],
    rows: rowsFor(group),
  })).filter((entry) => entry.rows.length > 0);
}
