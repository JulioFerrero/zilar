// Hand-written row types for the tables the server reads and writes. Each
// shape follows the migration SQL in `apps/server/drizzle/`, and a schema change
// must update both the migration and this file.

// Row of the `invites` table.
export interface InviteRow {
  id: string;
  code: string;
  createdBy: string | null;
  createdAt: Date;
  expiresAt: Date;
  maxUses: number;
  uses: number;
  revokedAt: Date | null;
}

// Row of the `xmpp_accounts` table.
export interface XmppAccountRow {
  userId: string;
  localpart: string;
  jid: string;
  provisioned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Row of the `groups` table.
export interface GroupRow {
  id: string;
  roomLocalpart: string;
  title: string;
  createdBy: string;
  membersCanCreateTopics: boolean;
  kind: 'group' | 'channel';
  description: string | null;
  visibility: 'private' | 'public';
  backgroundPreset: string | null;
  backgroundImageId: string | null;
  backgroundDim: number | null;
  listenerEnabled: boolean;
  listenerEagerness: 'quiet' | 'normal' | 'eager';
  createdAt: Date;
}

// Row of the `group_invite_links` table.
export interface GroupInviteLinkRow {
  id: string;
  groupId: string;
  tokenHash: string;
  tokenHint: string;
  label: string | null;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date | null;
  maxUses: number | null;
  uses: number;
  revokedAt: Date | null;
}

// Row of the `group_members` table.
export interface GroupMemberRow {
  groupId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  addedAt: Date;
}

// Row of the `group_ais` table.
export interface GroupAiRow {
  groupId: string;
  aiId: string;
  addedBy: string;
  addedAt: Date;
}

// Row of the `topics` table.
export interface TopicRow {
  id: string;
  groupId: string;
  name: string;
  glyph: string;
  roomLocalpart: string;
  visibility: 'public' | 'private';
  kind: 'chat' | 'task' | 'bug' | 'ui' | 'routine';
  status: 'open' | 'in_progress' | 'in_review' | 'blocked' | 'done';
  ownerUserId: string | null;
  ownerAiId: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  approverRoleId: string | null;
  isGeneral: boolean;
  archivedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

// Row of the `group_roles` table.
export interface GroupRoleRow {
  id: string;
  groupId: string;
  name: string;
  createdBy: string;
  createdAt: Date;
}

// Row of the `ais` table.
export interface AisRow {
  id: string;
  owner: string;
  name: string;
  template: 'dev' | 'marketing' | 'fun' | 'custom';
  persona: string;
  previousPersona: string | null;
  providerConnectionId: string;
  model: string;
  localpart: string;
  jid: string;
  status: 'active' | 'disabled' | 'stopped';
  machineId: string | null;
  canDelegate: boolean;
  acceptsDelegation: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Row of the `pinned_messages` table.
export interface PinnedMessageRow {
  id: string;
  chatJid: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: 'text' | 'image' | 'file' | 'voice' | 'card';
  pinnedBy: string;
  pinnedAt: Date;
}

// Row of the `chat_backgrounds` table.
export interface ChatBackgroundRow {
  id: string;
  userId: string;
  mime: 'image/webp' | 'image/png';
  width: number | null;
  height: number | null;
  bytes: number | null;
  storageKey: string;
  createdAt: Date;
}

// Row of the `chat_prefs` table.
export interface ChatPrefRow {
  userId: string;
  chatJid: string;
  mutedUntil: Date | null;
  archived: boolean;
  pinnedAt: Date | null;
  backgroundPreset: string | null;
  backgroundImageId: string | null;
  backgroundDim: number | null;
  updatedAt: Date;
}

// Row of the `chat_folders` table.
export interface ChatFolderRow {
  id: string;
  userId: string;
  name: string;
  icon: string;
  position: number;
  includeTypes: string[];
  includeChats: string[];
  excludeChats: string[];
  excludeMuted: boolean;
  excludeRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Row of the `sticker_packs` table.
export interface StickerPackRow {
  id: string;
  ownerId: string;
  title: string;
  visibility: 'private' | 'server';
  importedFrom: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Row of the `stickers` table.
export interface StickerRow {
  id: string;
  packId: string;
  position: number;
  emoji: string | null;
  mime: 'image/webp' | 'image/png';
  width: number;
  height: number;
  bytes: number;
  storageKey: string;
  sourceId: string | null;
  createdAt: Date;
}

export type AvatarOwnerKind = 'user' | 'ai' | 'group';

// Row of the `avatars` table.
export interface AvatarRow {
  id: string;
  ownerKind: AvatarOwnerKind;
  ownerId: string;
  mime: 'image/webp' | 'image/png';
  width: number | null;
  height: number | null;
  bytes: number | null;
  storageKey: string;
  createdAt: Date;
}

// Row of the `push_subscriptions` table.
export interface PushSubscriptionRow {
  id: string;
  userId: string;
  node: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  failedAt: Date | null;
}

// Row of the `push_settings` table.
export interface PushSettingRow {
  userId: string;
  showPreviews: boolean;
  updatedAt: Date;
}

// Row of the `machines` table.
export interface MachineRow {
  id: string;
  ownerUserId: string;
  name: string;
  publicKey: string;
  capabilities: Record<string, unknown>;
  status: 'pending' | 'approved' | 'revoked';
  createdAt: Date;
  approvedAt: Date | null;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
}

// Row of the `machine_pairing_codes` table.
export interface MachinePairingCodeRow {
  id: string;
  ownerUserId: string;
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export * from './rows-agents';
