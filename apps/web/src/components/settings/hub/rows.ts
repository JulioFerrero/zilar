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
 * The `/settings/<page>` routes the web app serves today (`AppRoutes.tsx`).
 * The shared list is the source of truth for both apps; a row whose page web
 * does not have is hidden here instead of becoming a dead link.
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

/** One lucide icon per settings icon id, the same set the mobile hub maps. */
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

/** The uppercase label over each hub card. */
const SETTINGS_GROUP_LABELS: Record<SettingsGroup, string> = {
  account: 'Account',
  ais: 'AIs and tools',
  chats: 'Chats',
  server: 'Server',
};

/** One card of the hub: a label above the rows web serves. */
export interface WebSettingsGroup {
  group: SettingsGroup;
  label: string;
  rows: SettingsItem[];
}

function rowsFor(group: SettingsGroup): SettingsItem[] {
  return SETTINGS_ITEMS.filter((item) => item.group === group && WEB_SETTINGS_HREFS.has(item.href));
}

/** The hub cards, one per non-empty group, in the group order. */
export function webSettingsGroups(): WebSettingsGroup[] {
  return SETTINGS_GROUP_ORDER.map((group) => ({
    group,
    label: SETTINGS_GROUP_LABELS[group],
    rows: rowsFor(group),
  })).filter((entry) => entry.rows.length > 0);
}
