// Hand-written row types; a schema change must update both the migration and this file.

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

export interface XmppAccountRow {
  userId: string;
  localpart: string;
  jid: string;
  provisioned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

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

export interface GroupMemberRow {
  groupId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  addedAt: Date;
}

// A member removed by an owner or admin cannot rejoin until one of them adds them back.
export interface GroupBanRow {
  groupId: string;
  userId: string;
  bannedBy: string | null;
  createdAt: Date;
}

export interface TopicMemberRow {
  topicId: string;
  userId: string;
  addedBy: string;
  addedAt: Date;
}

export interface GroupAiRow {
  groupId: string;
  aiId: string;
  addedBy: string;
  addedAt: Date;
}

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
  followerAiId: string | null;
  followPausedAt: Date | null;
  doneAt: Date | null;
  linkUrl: string | null;
  linkLabel: string | null;
  approverRoleId: string | null;
  isGeneral: boolean;
  archivedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupRoleRow {
  id: string;
  groupId: string;
  name: string;
  createdBy: string;
  createdAt: Date;
}

// `baseUrl` is the user's own OpenAI-compatible endpoint, validated at create; null for
// every other provider.
export interface ProviderConnectionRow {
  id: string;
  owner: string;
  provider: string;
  encryptedKey: string;
  label: string | null;
  baseUrl: string | null;
  status: 'active' | 'revoked';
  createdAt: Date;
  updatedAt: Date;
}

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
  // Where the AI's desk runs: `off` (default), `cloud`, `runner` or `auto`; only `cloud`
  // is wired so far.
  computerMode: 'off' | 'cloud' | 'runner' | 'auto';
  canDelegate: boolean;
  acceptsDelegation: boolean;
  createdAt: Date;
  updatedAt: Date;
}

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

export interface StickerPackRow {
  id: string;
  ownerId: string;
  title: string;
  visibility: 'private' | 'server';
  importedFrom: string | null;
  createdAt: Date;
  updatedAt: Date;
}

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

// Transport of a push device: `webpush` carries the endpoint and sealed keys; `fcm` and
// `apns` carry a plaintext device token.
export type PushDeviceKind = 'webpush' | 'fcm' | 'apns';

// A row is either Web Push (`kind = 'webpush'`, endpoint and keys set, token empty) or
// native (`fcm`/`apns`, token set, Web Push columns NULL); migration 0047's `shape_check`
// enforces that pair. Open a row through `openDevice` or `openNativeDevice`, never off the
// raw columns unchecked.
export interface PushSubscriptionRow {
  id: string;
  userId: string;
  node: string;
  // The session that registered the device; the FK cascades on revocation. NULL is a
  // legacy registration.
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
  // Short reason stored with `failedAt`: the FCM error code or `http-<status>`, at most
  // 64 chars; cleared with `failedAt` on success.
  lastFailure: string | null;
}

export interface PushSettingRow {
  userId: string;
  showPreviews: boolean;
  updatedAt: Date;
}

// One row per AI per UTC day, added to after every model call. Token columns are
// `bigint` and `costUsd` is `numeric`, both read back as strings.
export interface AiUsageRow {
  aiId: string;
  day: Date;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  costUsd: string;
  updatedAt: Date;
}

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

export interface MachinePairingCodeRow {
  id: string;
  ownerUserId: string;
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface ChatReadRow {
  userId: string;
  chatJid: string;
  lastReadId: string;
  updatedAt: Date;
}

// The caller's confirmed delivery mark per chat, an archive id in the author's terms.
export interface ChatDeliveryRow {
  userId: string;
  chatJid: string;
  deliveredId: string;
  updatedAt: Date;
}

// The short profile bio lives in its own table so Better Auth's `user` table stays as
// Better Auth expects it.
export interface UserProfileRow {
  userId: string;
  bio: string;
  timeZone: string | null;
  updatedAt: Date;
}

// The 7-day grace before the deletion job runs. `userId` deliberately has no FK: the row
// must outlive the user delete.
export type UserDeletionPhase = 'scheduled' | 'running' | 'failed';

export interface UserDeletionRow {
  userId: string;
  requestedAt: Date;
  deleteAfter: Date;
  phase: UserDeletionPhase;
  startedAt: Date | null;
  lastError: string | null;
}

// One append-only step of an AI task's session log, keyed by `task_id` and a per-task
// `seq`. `data` holds ids, counts and redacted tool text only.
export interface AgentTaskEventRow {
  id: string;
  taskId: string;
  aiId: string;
  ownerId: string;
  chatJid: string;
  seq: number;
  kind: string;
  at: Date;
  durationMs: number | null;
  data: Record<string, unknown>;
}
