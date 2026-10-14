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
  unreadMark: boolean;
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

// Which transport a push device speaks. `webpush` rows carry the Web Push
// endpoint and sealed keys; `fcm`/`apns` rows carry a plaintext device token.
export type PushDeviceKind = 'webpush' | 'fcm' | 'apns';

// Row of the `push_subscriptions` table. A row is either a Web Push row
// (`kind = 'webpush'`, endpoint and sealed keys set, `token` empty) or a native
// row (`kind = 'fcm' | 'apns'`, `token` set, the Web Push columns empty);
// migration 0047's `shape_check` enforces that pair. The Web Push columns are
// nullable because a native row leaves them NULL; a Web Push reader opens a row
// through `openDevice`, and a native row through `openNativeDevice`, never off
// the raw columns unchecked.
export interface PushSubscriptionRow {
  id: string;
  userId: string;
  node: string;
  // The session that registered the device (T-1255). The FK cascades the row
  // away when that session is revoked; a NULL row is a legacy registration.
  sessionId: string | null;
  kind: PushDeviceKind;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  token: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  failedAt: Date | null;
  // Short reason stored with `failedAt` (migration 0054): the FCM error code
  // or `http-<status>`, at most 64 chars. Cleared with `failedAt` on success.
  lastFailure: string | null;
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

// Row of the `chat_reads` table.
export interface ChatReadRow {
  userId: string;
  chatJid: string;
  lastReadId: string;
  updatedAt: Date;
}

// Row of the `chat_deliveries` table (T-1229): the caller's confirmed
// delivery mark per chat, an archive id in the author's terms.
export interface ChatDeliveryRow {
  userId: string;
  chatJid: string;
  deliveredId: string;
  updatedAt: Date;
}

// Row of the `user_profiles` table (T-1258): the short profile bio, in its own
// table so Better Auth's `user` table stays as Better Auth expects it.
export interface UserProfileRow {
  userId: string;
  bio: string;
  updatedAt: Date;
}

// Row of the `user_deletions` table (T-1261): the 7-day grace before the
// deletion job runs (`docs/audit/account-deletion-plan.md` §5a). `userId`
// deliberately has no FK: the row must outlive the user delete.
export type UserDeletionPhase = 'scheduled' | 'running' | 'failed';

export interface UserDeletionRow {
  userId: string;
  requestedAt: Date;
  deleteAfter: Date;
  phase: UserDeletionPhase;
  startedAt: Date | null;
  lastError: string | null;
}

export * from './rows-agents';
