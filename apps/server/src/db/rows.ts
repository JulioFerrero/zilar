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

// Row of the `approvals` table.
export interface ApprovalRow {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  action: string;
  summary: string;
  details: string | null;
  argsHash: string;
  worstCaseCurrency: string | null;
  worstCaseAmount: string | null;
  requestedBy: string;
  status: 'pending' | 'approved_once' | 'approved_always' | 'denied' | 'consumed';
  decidedBy: string | null;
  decidedAt: Date | null;
  note: string | null;
  expiresAt: Date;
  createdAt: Date;
}

// Insert shape of the `approvals` table.
export interface ApprovalInsert {
  id: string;
  aiId: string;
  groupId?: string | null | undefined;
  topicId?: string | null | undefined;
  action: string;
  summary: string;
  details?: string | null | undefined;
  argsHash: string;
  worstCaseCurrency?: string | null | undefined;
  worstCaseAmount?: string | null | undefined;
  requestedBy: string;
  status?: 'pending' | 'approved_once' | 'approved_always' | 'denied' | 'consumed' | undefined;
  decidedBy?: string | null | undefined;
  decidedAt?: Date | null | undefined;
  note?: string | null | undefined;
  expiresAt: Date;
  createdAt?: Date | undefined;
}

// Row of the `pending_actions` table.
export interface PendingActionRow {
  id: string;
  approvalId: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  action: string;
  args: unknown;
  argsHash: string;
  requestedBy: string;
  status: 'waiting' | 'running' | 'executed' | 'failed' | 'cancelled';
  resultSummary: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

// Row of the `approval_rules` table.
export interface ApprovalRuleRow {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  action: string;
  createdBy: string;
  createdAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
}

// Row of the `ai_tools` table.
export interface AiToolRow {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  name: string;
  description: string;
  currentVersion: number;
  approvedHosts: string[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// Row of the `ai_tool_versions` table.
export interface AiToolVersionRow {
  id: string;
  toolId: string;
  version: number;
  source: string;
  hosts: string[];
  message: string;
  createdBy: string;
  createdAt: Date;
}

// Row of the `ai_tool_runs` table.
export interface AiToolRunRow {
  id: string;
  toolId: string;
  version: number;
  trigger: 'manual' | 'routine' | 'ai';
  status: 'ok' | 'error';
  errorKind: string | null;
  durationMs: number;
  fetchCount: number;
  outputText: string | null;
  createdAt: Date;
}

// Row of the `routines` table.
export interface RoutineRow {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  toolId: string;
  title: string;
  schedule: unknown;
  input: unknown;
  approvedHosts: string[];
  status: 'active' | 'paused' | 'needs_approval';
  pausedReason: 'user' | 'failures' | 'hosts_changed' | null;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastStatus: 'ok' | 'error' | 'skipped' | null;
  consecutiveFailures: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// Row of the `media_items` table.
export interface MediaItemRow {
  id: string;
  archiveOwner: string;
  chatJid: string;
  messageId: string;
  atMicros: number;
  senderJid: string;
  kind: 'image' | 'file' | 'gif' | 'voice' | 'link';
  url: string | null;
  name: string | null;
  mime: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  waveform: number[] | null;
  linkUrl: string | null;
  linkHost: string | null;
  ref: string;
  deleted: boolean;
  createdAt: Date;
}
