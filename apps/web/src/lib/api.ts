import { z } from 'zod';
import { isMockApiEnabled } from '@/mock/gate';
import { mockRequest } from '@/mock/api';

/** Base path for the server API. The Vite dev server proxies it same-origin. */
export const API_BASE = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  image: z.string().nullable().optional(),
  jid: z.string().nullable().optional(),
});

export type Me = z.infer<typeof meSchema>;

const contactSchema = z.object({
  userId: z.string(),
  name: z.string(),
  jid: z.string(),
  avatarUrl: z.string().optional(),
});

export type Contact = z.infer<typeof contactSchema>;

const dmEntrySchema = z.object({
  kind: z.literal('dm'),
  chatJid: z.string(),
  title: z.string(),
  userId: z.string().optional(),
  avatarUrl: z.string().optional(),
  /** Set on the caller's AIs; absent or false for human contacts. */
  isAi: z.boolean().optional(),
});

const groupEntrySchema = z.object({
  kind: z.literal('group'),
  chatJid: z.string(),
  title: z.string(),
  groupId: z.string(),
  memberCount: z.number(),
  role: z.enum(['owner', 'admin', 'member']),
  // T-0111: present on servers with topics (T-0108); absent on older ones.
  // Parsed loosely here — each entry is validated by `topicSchema` when
  // mapping to chats — and unknown entries are dropped there.
  topics: z.array(z.unknown()).optional(),
});

const chatEntrySchema = z.discriminatedUnion('kind', [dmEntrySchema, groupEntrySchema]);

export type ChatEntry = z.infer<typeof chatEntrySchema>;

/**
 * The validated topics of a group chat entry: entries that parse as
 * `topicSchema` (malformed ones are dropped). An older server omits
 * `topics` entirely, so the result is empty for it.
 */
export function chatEntryTopics(entry: ChatEntry): Topic[] {
  if (entry.kind !== 'group' || entry.topics === undefined) {
    return [];
  }
  const result: Topic[] = [];
  for (const raw of entry.topics) {
    const parsed = topicSchema.safeParse(raw);
    if (parsed.success) {
      result.push(parsed.data);
    }
  }
  return result;
}

const chatsSchema = z.object({ chats: z.array(chatEntrySchema) });

const groupMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
  // T-0116: the custom group roles this member holds. Optional so payloads
  // from an older server still parse (treated as none).
  roles: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
});

const groupAiSchema = z.object({
  aiId: z.string(),
  jid: z.string(),
  name: z.string(),
  ownerId: z.string(),
});

const groupDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdBy: z.string(),
  // T-0108: plain members may create topics when the switch is on. Optional
  // so payloads from an older server still parse (treated as off).
  membersCanCreateTopics: z.boolean().optional(),
  members: z.array(groupMemberSchema),
  ais: z.array(groupAiSchema),
});

export type GroupMember = z.infer<typeof groupMemberSchema>;
export type GroupAi = z.infer<typeof groupAiSchema>;
export type GroupDetail = z.infer<typeof groupDetailSchema>;

const inviteSchema = z.object({
  code: z.string(),
  url: z.string(),
  expiresAt: z.string().optional(),
});

export type Invite = z.infer<typeof inviteSchema>;

const xmppTokenSchema = z.object({
  jid: z.string(),
  token: z.string(),
  expiresAt: z.string(),
  service: z.string(),
  domain: z.string(),
  mucDomain: z.string(),
});

export type XmppToken = z.infer<typeof xmppTokenSchema>;

async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  let response: Response;
  if (isMockApiEnabled()) {
    // Standalone mock mode: answer locally, never touch the network (T-0069).
    response = await mockRequest(path, init);
  } else {
    try {
      const headers = new Headers(init.headers);
      if (!headers.has('Accept')) {
        headers.set('Accept', 'application/json');
      }
      response = await fetch(`${API_BASE}${path}`, {
        credentials: 'same-origin',
        ...init,
        headers,
      });
    } catch {
      throw new ApiError(0, 'network_error', 'Could not reach the server');
    }
  }

  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(raw);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error.code : 'request_failed',
      parsed.success ? parsed.data.error.message : `Request failed (${response.status})`,
    );
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server sent an unexpected response',
    );
  }
  return parsed.data;
}

export function getMe(): Promise<Me> {
  return request('/me', meSchema);
}

export function updateMe(name: string): Promise<Me> {
  return request('/me', meSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function getChats(): Promise<ChatEntry[]> {
  const { chats } = await request('/chats', chatsSchema);
  return chats;
}

export async function getContacts(): Promise<Contact[]> {
  return request('/contacts', z.array(contactSchema));
}

export function createGroup(input: { title: string; memberIds: string[] }): Promise<GroupDetail> {
  return request('/groups', groupDetailSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function getGroup(groupId: string): Promise<GroupDetail> {
  return request(`/groups/${encodeURIComponent(groupId)}`, groupDetailSchema);
}

// T-0054: an owner or admin adds their own AI to a group, and its owner or a
// group manager removes it. Both answer the fresh group detail.
export function addGroupAi(groupId: string, aiId: string): Promise<GroupDetail> {
  return request(`/groups/${encodeURIComponent(groupId)}/ais`, groupDetailSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aiId }),
  });
}

export function removeGroupAi(groupId: string, aiId: string): Promise<GroupDetail> {
  return request(
    `/groups/${encodeURIComponent(groupId)}/ais/${encodeURIComponent(aiId)}`,
    groupDetailSchema,
    { method: 'DELETE' },
  );
}

export function createInvite(): Promise<Invite> {
  return request('/invites', inviteSchema, { method: 'POST' });
}

export function getInvite(code: string): Promise<{ valid: boolean }> {
  return request(`/invites/${encodeURIComponent(code)}`, z.object({ valid: z.boolean() }));
}

export function getXmppToken(): Promise<XmppToken> {
  return request('/xmpp/token', xmppTokenSchema, { method: 'POST' });
}

// --- Topics (T-0111) -------------------------------------------------------
// The wire contract lives in apps/server/src/topics/{routes,service,access}
// (T-0108/T-0109/T-0110). Only what the web UI shows is modelled here: list,
// create, patch (the strip, visibility, archive), members and AIs, plus the
// group's `membersCanCreateTopics` switch. A group entry in `/api/chats`
// carries its visible `topics` (archived excluded); older servers omit the
// field, and the store treats such a group exactly as before. A topic the
// viewer may not see is a 404 everywhere, byte-identical to a missing id.
export const topicKindSchema = z.enum(['chat', 'task', 'bug', 'ui', 'routine']);

export type TopicKind = z.infer<typeof topicKindSchema>;

export const topicStatusSchema = z.enum(['open', 'in_progress', 'in_review', 'blocked', 'done']);

export type TopicStatus = z.infer<typeof topicStatusSchema>;

export const topicVisibilitySchema = z.enum(['public', 'private']);

export type TopicVisibility = z.infer<typeof topicVisibilitySchema>;

export const topicOwnerSchema = z.object({
  kind: z.enum(['user', 'ai']),
  id: z.string(),
  name: z.string(),
});

export type TopicOwner = z.infer<typeof topicOwnerSchema>;

export const topicAiSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type TopicAi = z.infer<typeof topicAiSchema>;

// T-0116: a custom group role attached to a topic (`roles`) or named as its
// approver (`approverRole`). `memberCount` counts current holders.
export const topicRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  memberCount: z.number(),
});

export type TopicRole = z.infer<typeof topicRoleSchema>;

export const approverRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type ApproverRole = z.infer<typeof approverRoleSchema>;

export const topicSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  name: z.string(),
  glyph: z.string(),
  chatJid: z.string(),
  visibility: topicVisibilitySchema,
  kind: topicKindSchema,
  status: topicStatusSchema,
  owner: topicOwnerSchema.nullable(),
  linkUrl: z.string().nullable(),
  linkLabel: z.string().nullable(),
  isGeneral: z.boolean(),
  archived: z.boolean(),
  memberCount: z.number(),
  ais: z.array(topicAiSchema),
  // T-0116: roles with access and the approver role. Optional so payloads
  // from an older server still parse (treated as none).
  roles: z.array(topicRoleSchema).optional(),
  approverRole: approverRoleSchema.nullable().optional(),
});

export type Topic = z.infer<typeof topicSchema>;

export const topicMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
});

export type TopicMember = z.infer<typeof topicMemberSchema>;

export interface CreateTopicInput {
  name: string;
  kind?: TopicKind;
  visibility?: TopicVisibility;
  memberIds?: string[];
  glyph?: string;
  owner?: { kind: 'user' | 'ai'; id: string } | null;
  linkUrl?: string | null;
  linkLabel?: string | null;
}

export interface PatchTopicInput {
  name?: string;
  glyph?: string;
  kind?: TopicKind;
  status?: TopicStatus;
  owner?: { kind: 'user' | 'ai'; id: string } | null;
  linkUrl?: string | null;
  linkLabel?: string | null;
  archived?: true;
  visibility?: TopicVisibility;
  memberIds?: string[];
  confirmExposeHistory?: boolean;
}

export function listGroupTopics(groupId: string): Promise<Topic[]> {
  return request(
    `/groups/${encodeURIComponent(groupId)}/topics`,
    z.object({ topics: z.array(topicSchema) }),
  ).then(({ topics }) => topics);
}

export function createTopic(groupId: string, input: CreateTopicInput): Promise<Topic> {
  return request(`/groups/${encodeURIComponent(groupId)}/topics`, topicSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function getTopic(id: string): Promise<Topic> {
  return request(`/topics/${encodeURIComponent(id)}`, topicSchema);
}

export function patchTopic(id: string, input: PatchTopicInput): Promise<Topic> {
  return request(`/topics/${encodeURIComponent(id)}`, topicSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function archiveTopic(id: string): Promise<Topic> {
  return request(`/topics/${encodeURIComponent(id)}/archive`, topicSchema, { method: 'POST' });
}

export function listTopicMembers(id: string): Promise<TopicMember[]> {
  return request(
    `/topics/${encodeURIComponent(id)}/members`,
    z.object({ members: z.array(topicMemberSchema) }),
  ).then(({ members }) => members);
}

export function addTopicMember(id: string, userId: string): Promise<Topic> {
  return request(`/topics/${encodeURIComponent(id)}/members`, topicSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
}

export function removeTopicMember(id: string, userId: string): Promise<Topic> {
  return request(
    `/topics/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
    topicSchema,
    {
      method: 'DELETE',
    },
  );
}

export function listTopicAis(id: string): Promise<TopicAi[]> {
  return request(
    `/topics/${encodeURIComponent(id)}/ais`,
    z.object({ ais: z.array(topicAiSchema) }),
  ).then(({ ais }) => ais);
}

export function addTopicAi(id: string, aiId: string): Promise<Topic> {
  return request(`/topics/${encodeURIComponent(id)}/ais`, topicSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aiId }),
  });
}

export function removeTopicAi(id: string, aiId: string): Promise<Topic> {
  return request(`/topics/${encodeURIComponent(id)}/ais/${encodeURIComponent(aiId)}`, topicSchema, {
    method: 'DELETE',
  });
}

// --- Group roles (T-0116) ---------------------------------------------------
// Custom group roles: labels with two powers (private-topic access and
// approver rights). Reading needs only membership; every write needs a
// group owner/admin.

export const groupRoleMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
});

export type GroupRoleMember = z.infer<typeof groupRoleMemberSchema>;

export const groupRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  members: z.array(groupRoleMemberSchema),
});

export type GroupRole = z.infer<typeof groupRoleSchema>;

export function listGroupRoles(groupId: string): Promise<GroupRole[]> {
  return request(
    `/groups/${encodeURIComponent(groupId)}/roles`,
    z.object({ roles: z.array(groupRoleSchema) }),
  ).then(({ roles }) => roles);
}

export function createGroupRole(groupId: string, name: string): Promise<GroupRole> {
  return request(`/groups/${encodeURIComponent(groupId)}/roles`, groupRoleSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function renameGroupRole(groupId: string, roleId: string, name: string): Promise<GroupRole> {
  return request(
    `/groups/${encodeURIComponent(groupId)}/roles/${encodeURIComponent(roleId)}`,
    groupRoleSchema,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  );
}

export async function deleteGroupRole(groupId: string, roleId: string): Promise<void> {
  await request(
    `/groups/${encodeURIComponent(groupId)}/roles/${encodeURIComponent(roleId)}`,
    z.null(),
    { method: 'DELETE' },
  );
}

export function setGroupRoleMembers(
  groupId: string,
  roleId: string,
  userIds: string[],
): Promise<GroupRole> {
  return request(
    `/groups/${encodeURIComponent(groupId)}/roles/${encodeURIComponent(roleId)}/members`,
    groupRoleSchema,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds }),
    },
  );
}

export interface SetTopicRolesInput {
  roleIds: string[];
  approverRoleId: string | null;
}

export function setTopicRoles(id: string, input: SetTopicRolesInput): Promise<Topic> {
  return request(`/topics/${encodeURIComponent(id)}/roles`, topicSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

// T-0108: the group owner/admin switch for plain members creating topics.
export function setMembersCanCreateTopics(
  groupId: string,
  membersCanCreateTopics: boolean,
): Promise<GroupDetail> {
  return request(`/groups/${encodeURIComponent(groupId)}`, groupDetailSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ membersCanCreateTopics }),
  });
}

// Web UI helper for T-0111: the panel shows the rules of one topic, read
// through the existing per-group list (each row carries its `topicId`).
// Declared as a type alias (not a const) because the approval schemas are
// defined further below in this file.
export type TopicApprovalRule = z.infer<typeof approvalRuleSchema>;

export function listTopicApprovalRules(groupId: string): Promise<TopicApprovalRule[]> {
  return listGroupApprovalRules(groupId);
}

export const topicToolSchema = z.object({
  id: z.string(),
  aiId: z.string(),
  groupId: z.string().nullable(),
  topicId: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  currentVersion: z.number(),
  hosts: z.array(z.string()),
  lastRunStatus: z.string().nullable(),
  updatedAt: z.string(),
});

export type TopicTool = z.infer<typeof topicToolSchema>;

export function listTopicTools(topicId: string): Promise<TopicTool[]> {
  return request(`/topics/${encodeURIComponent(topicId)}/tools`, z.array(topicToolSchema));
}

// --- Group invite links (T-0115) -------------------------------------------
// Shareable links that join a group as `member` (`${WEB}/j/<token>` on the
// web). The token is shown once at creation and never stored — the list
// below carries hints, labels, uses and state, never tokens.
export const groupInviteLinkSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  tokenHint: z.string(),
  uses: z.number(),
  maxUses: z.number().nullable(),
  expiresAt: z.string().nullable(),
  revoked: z.boolean(),
  createdAt: z.string(),
});

export type GroupInviteLink = z.infer<typeof groupInviteLinkSchema>;

const groupInviteLinksSchema = z.object({ links: z.array(groupInviteLinkSchema) });

const createdInviteLinkSchema = z.object({
  id: z.string(),
  token: z.string(),
  url: z.string(),
});

export type CreatedInviteLink = z.infer<typeof createdInviteLinkSchema>;

export interface CreateGroupInviteLinkInput {
  label?: string;
  expiresInHours?: number;
  maxUses?: number;
}

export function createGroupInviteLink(
  groupId: string,
  input: CreateGroupInviteLinkInput = {},
): Promise<CreatedInviteLink> {
  return request(`/groups/${encodeURIComponent(groupId)}/invite-links`, createdInviteLinkSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function listGroupInviteLinks(groupId: string): Promise<GroupInviteLink[]> {
  return request(
    `/groups/${encodeURIComponent(groupId)}/invite-links`,
    groupInviteLinksSchema,
  ).then(({ links }) => links);
}

export async function revokeGroupInviteLink(groupId: string, linkId: string): Promise<void> {
  await request(
    `/groups/${encodeURIComponent(groupId)}/invite-links/${encodeURIComponent(linkId)}`,
    z.null(),
    { method: 'DELETE' },
  );
}

// --- Join by link (T-0115) -------------------------------------------------
// The preview names the group and counts its members — never member names,
// and never the group id unless the caller is already a member (they know
// it; the join page opens the group chat with it). Joining adds the caller
// as `member` and returns the group id; an existing member answers
// `alreadyMember: true` without consuming a use.

export const joinPreviewSchema = z.object({
  groupTitle: z.string(),
  memberCount: z.number(),
  alreadyMember: z.boolean(),
  groupId: z.string().optional(),
});

export type JoinPreview = z.infer<typeof joinPreviewSchema>;

const joinResultSchema = z.object({
  groupId: z.string(),
  alreadyMember: z.boolean(),
});

export type JoinResult = z.infer<typeof joinResultSchema>;

export function previewJoinLink(token: string): Promise<JoinPreview> {
  return request(`/join/${encodeURIComponent(token)}`, joinPreviewSchema);
}

export function joinByLink(token: string): Promise<JoinResult> {
  return request(`/join/${encodeURIComponent(token)}`, joinResultSchema, { method: 'POST' });
}

// --- Chat preferences (T-0113) -------------------------------------------------
// Per-user mute/archive/pin rows, synced across devices. The wire contract
// lives in apps/server/src/chat-prefs/routes.ts and service.ts. Muting a
// group covers its topics (the pref sits on the General room JID and the
// client applies it to every topic unless the topic has its own row).

const chatPrefSchema = z.object({
  chatJid: z.string(),
  mutedUntil: z.string().nullable(),
  archived: z.boolean(),
  pinnedAt: z.string().nullable(),
  updatedAt: z.string(),
});

export type ChatPref = z.infer<typeof chatPrefSchema>;

const chatPrefsSchema = z.object({ prefs: z.array(chatPrefSchema) });

export interface PutChatPrefInput {
  mutedUntil?: string | null | undefined;
  archived?: boolean | undefined;
  pinned?: boolean | undefined;
}

export function listChatPrefs(): Promise<ChatPref[]> {
  return request('/chat-prefs', chatPrefsSchema).then((body) => body.prefs);
}

export async function putChatPref(
  chatJid: string,
  input: PutChatPrefInput,
): Promise<ChatPref | null> {
  const raw: unknown = await request(
    `/chat-prefs/${encodeURIComponent(chatJid)}`,
    z.union([chatPrefSchema, z.object({ prefs: z.null() })]),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  if (typeof raw === 'object' && raw !== null && 'prefs' in raw) {
    return null;
  }
  return chatPrefSchema.parse(raw);
}

// --- Pinned messages (T-0114) ------------------------------------------------
// The wire contract lives in apps/server/src/pins/{routes,service,access}.
// `chat` is a room bare JID for groups/topics, or a DM peer's bare JID (the
// server keeps the canonical pair key, so both sides share one list). Pins
// arrive newest first. The snapshot (`senderName`/`text`/`kind`) is display
// only: the server trusts it for rendering, never for authorization.

export const pinKindSchema = z.enum(['text', 'image', 'file', 'voice', 'card']);

export type PinKind = z.infer<typeof pinKindSchema>;

export const pinSchema = z.object({
  id: z.string(),
  chat: z.string(),
  messageId: z.string(),
  senderName: z.string(),
  text: z.string(),
  kind: pinKindSchema,
  pinnedBy: z.string(),
  pinnedAt: z.string(),
});

export type Pin = z.infer<typeof pinSchema>;

const pinsSchema = z.object({ pins: z.array(pinSchema) });

export interface PinMessageInput {
  chat: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: PinKind;
}

export function listPins(chat: string): Promise<Pin[]> {
  const params = new URLSearchParams();
  params.set('chat', chat);
  return request(`/pins?${params.toString()}`, pinsSchema).then((body) => body.pins);
}

export function pinMessage(input: PinMessageInput): Promise<Pin> {
  return request('/pins', pinSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function unpinMessage(id: string): Promise<void> {
  await request(`/pins/${encodeURIComponent(id)}`, pinSchema, { method: 'DELETE' });
}

// --- AIs (T-0032) --------------------------------------------------------
// The wire contract lives in apps/server/src/ais/routes.ts and service.ts.
// `ApiError` already carries the server's `code` and `status`, so callers can
// branch without parsing the message again.

const aiTemplateSchema = z.enum(['dev', 'marketing', 'fun', 'custom']);

export type AiTemplate = z.infer<typeof aiTemplateSchema>;

const aiLimitsSchema = z.object({
  perDayUsd: z.number(),
  perMonthUsd: z.number(),
});

export type AiLimits = z.infer<typeof aiLimitsSchema>;

// T-0058: the AI's spend summary. Optional (not just nullable) so responses
// from older servers still parse; absent means "unavailable" like null.
const aiUsageSchema = z.object({
  todayUsd: z.number(),
  windowUsd: z.number(),
});

export type AiUsage = z.infer<typeof aiUsageSchema>;

const publicAiSchema = z.object({
  id: z.string(),
  name: z.string(),
  template: aiTemplateSchema,
  persona: z.string(),
  model: z.string(),
  jid: z.string(),
  // `stopped` is the owner kill switch (T-0080): the AI is paused, not
  // deleted, and a resume brings it back.
  status: z.enum(['active', 'disabled', 'stopped']),
  providerConnectionId: z.string(),
  limits: aiLimitsSchema,
  usage: aiUsageSchema.nullable().optional(),
  // T-0091: the AI's home machine id, or null when it runs on the platform.
  // Optional so a payload from a server that has not been upgraded yet
  // still parses — the panel renders the same way when it is absent.
  machineId: z.string().nullable().optional(),
  createdAt: z.string(),
});

export type PublicAi = z.infer<typeof publicAiSchema>;

const connectionSchema = z.object({
  id: z.string(),
  provider: z.string(),
  label: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
});

export type Connection = z.infer<typeof connectionSchema>;

export interface CreateAiInput {
  name: string;
  template: AiTemplate;
  persona?: string;
  providerConnectionId: string;
  model: string;
  limits: AiLimits;
}

export interface UpdateAiInput {
  name?: string;
  persona?: string;
  limits?: AiLimits;
  model?: string;
  providerConnectionId?: string;
}

export function listAis(): Promise<PublicAi[]> {
  return request('/ais', z.array(publicAiSchema));
}

export function getAi(id: string): Promise<PublicAi> {
  return request(`/ais/${encodeURIComponent(id)}`, publicAiSchema);
}

export function createAi(input: CreateAiInput): Promise<PublicAi> {
  const body = {
    name: input.name,
    template: input.template,
    ...(input.persona === undefined ? {} : { persona: input.persona }),
    providerConnectionId: input.providerConnectionId,
    model: input.model,
    limits: input.limits,
  };
  return request('/ais', publicAiSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function updateAi(id: string, input: UpdateAiInput): Promise<PublicAi> {
  return request(`/ais/${encodeURIComponent(id)}`, publicAiSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function deleteAi(id: string): Promise<void> {
  await request(`/ais/${encodeURIComponent(id)}`, z.null(), { method: 'DELETE' });
}

// T-0080: the owner's kill switch. Both return the fresh public AI so the
// panel can re-render against the server truth without a second GET. The
// server answers the same `not_active` 409 when the AI was already in the
// other terminal state, which the panel treats as a refresh cue.
export function stopAi(id: string): Promise<PublicAi> {
  return request(`/ais/${encodeURIComponent(id)}/stop`, publicAiSchema, { method: 'POST' });
}

export function resumeAi(id: string): Promise<PublicAi> {
  return request(`/ais/${encodeURIComponent(id)}/resume`, publicAiSchema, { method: 'POST' });
}

// T-0091: set or clear the AI's home machine. `null` clears the assignment
// (the AI runs on the platform); a machine id assigns it. The server
// answers the fresh public AI, so the panel re-renders against server
// truth.
export function setAiMachine(aiId: string, machineId: string | null): Promise<PublicAi> {
  return request(`/ais/${encodeURIComponent(aiId)}/machine`, publicAiSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machineId: machineId }),
  });
}

export function listConnections(): Promise<Connection[]> {
  return request('/connections', z.array(connectionSchema));
}

// T-0074: `ConnectionsPage` used to call `fetch` directly with its own copy of
// `request`. Moving those calls here means errors flow through `ApiError` like
// everywhere else; `ApiError.message` already carries the server's
// `error.message`, so the page can keep showing it to the user.

export interface CreateConnectionInput {
  provider: string;
  key: string;
  label?: string;
}

export function createConnection(input: CreateConnectionInput): Promise<Connection> {
  const body = {
    provider: input.provider,
    key: input.key,
    ...(input.label === undefined ? {} : { label: input.label }),
  };
  return request('/connections', connectionSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const connectionTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
});

export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;

export function testConnection(id: string): Promise<ConnectionTestResult> {
  return request(`/connections/${encodeURIComponent(id)}/test`, connectionTestResultSchema, {
    method: 'POST',
  });
}

export async function deleteConnection(id: string): Promise<void> {
  await request(`/connections/${encodeURIComponent(id)}`, z.null(), { method: 'DELETE' });
}

// --- Machines (T-0070) ---------------------------------------------------
// The wire contract lives in apps/server/src/machines/routes.ts and
// service.ts. `ApiError` carries the server's `code` and `status`, so callers
// can branch without parsing the message again. `online` is optional so the
// schema works before T-0071 (the runner hub) lands.

export type MachineStatus = 'pending' | 'approved' | 'revoked';

export interface Machine {
  id: string;
  name: string;
  status: MachineStatus;
  os: string;
  osVersion: string;
  arch: string;
  cpu: string;
  cores: number;
  ramGb: number;
  diskFreeGb: number;
  drivers: string[];
  fingerprint: string;
  createdAt: string;
  approvedAt: string | null;
  lastSeenAt: string | null;
  /** Added by T-0071 (the runner hub). Absent before then; default to false. */
  online?: boolean | undefined;
}

const machineStatusSchema = z.enum(['pending', 'approved', 'revoked']);

export const machineSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: machineStatusSchema,
  os: z.string(),
  osVersion: z.string(),
  arch: z.string(),
  cpu: z.string(),
  cores: z.number(),
  ramGb: z.number(),
  diskFreeGb: z.number(),
  drivers: z.array(z.string()),
  fingerprint: z.string(),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  online: z.boolean().optional(),
});

export interface PairingCode {
  code: string;
  expiresAt: string;
}

const pairingCodeSchema = z.object({
  code: z.string(),
  expiresAt: z.string(),
});

export function listMachines(): Promise<Machine[]> {
  return request('/machines', z.array(machineSchema));
}

export function createPairingCode(): Promise<PairingCode> {
  return request('/machines/pairing-codes', pairingCodeSchema, { method: 'POST' });
}

export function approveMachine(id: string): Promise<Machine> {
  return request(`/machines/${encodeURIComponent(id)}/approve`, machineSchema, {
    method: 'POST',
  });
}

export async function denyMachine(id: string): Promise<void> {
  await request(`/machines/${encodeURIComponent(id)}/deny`, z.null(), { method: 'POST' });
}

export function revokeMachine(id: string): Promise<Machine> {
  return request(`/machines/${encodeURIComponent(id)}/revoke`, machineSchema, {
    method: 'POST',
  });
}

export function renameMachine(id: string, name: string): Promise<Machine> {
  return request(`/machines/${encodeURIComponent(id)}`, machineSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function deleteMachine(id: string): Promise<void> {
  await request(`/machines/${encodeURIComponent(id)}`, z.null(), { method: 'DELETE' });
}

// --- Approvals (T-0076) ---------------------------------------------------
// The wire contract lives in apps/server/src/approvals/routes.ts and
// service.ts. Dates arrive as ISO strings; we keep them as strings so the
// types line up with `ApprovalRequest.expires_at` and we don't have to think
// about zod's string-to-Date coercion in tests.

export type ApprovalStatus =
  'pending' | 'approved_once' | 'approved_always' | 'denied' | 'consumed' | 'expired';

export type ApprovalDecision = 'approve_once' | 'approve_always' | 'deny';

const approvalWorstCaseSchema = z
  .object({
    currency: z.enum(['EUR', 'USD']),
    amount: z.number(),
  })
  .nullable();

export const publicApprovalSchema = z.object({
  id: z.string(),
  aiId: z.string(),
  groupId: z.string().nullable(),
  // T-0110: the topic the approval belongs to. Optional so older payloads
  // parse (a missing topic reads like a group approval).
  topicId: z.string().nullable().optional(),
  topicName: z.string().nullable().optional(),
  action: z.string(),
  summary: z.string(),
  details: z.string().nullable(),
  argsHash: z.string(),
  worstCase: approvalWorstCaseSchema,
  requestedBy: z.string(),
  status: z.enum(['pending', 'approved_once', 'approved_always', 'denied', 'consumed', 'expired']),
  decidedAt: z.string().nullable(),
  note: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
  // T-0100: whether `approve_always` is a real choice for this action.
  // Optional with a `false` default so a payload from a server that has not
  // been upgraded yet still parses — the card just hides the third button.
  alwaysEligible: z.boolean().default(false),
});

export type PublicApproval = z.infer<typeof publicApprovalSchema>;

export function getApproval(id: string): Promise<PublicApproval> {
  return request(`/approvals/${encodeURIComponent(id)}`, publicApprovalSchema);
}

// T-0081: the inbox page lists everything pending. The server already filters
// by pending, unexpired, decidable by the caller, newest first, max 100.
export function listApprovals(): Promise<PublicApproval[]> {
  return request('/approvals', z.array(publicApprovalSchema));
}

export function decideApproval(
  id: string,
  decision: ApprovalDecision,
  note?: string,
): Promise<PublicApproval> {
  const body = note === undefined ? { decision } : { decision, note };
  return request(`/approvals/${encodeURIComponent(id)}/decision`, publicApprovalSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// --- Approval rules (T-0100) ------------------------------------------------
// The wire contract lives in apps/server/src/approvals/routes.ts and
// rules.ts. Dates arrive as ISO strings, kept as strings like the
// approvals schemas. The two list routes 404 for a viewer who may not
// manage the rules, and so does revoke; all three flow through `ApiError`.

export const approvalRuleSchema = z.object({
  id: z.string(),
  action: z.string(),
  scope: z.enum(['personal', 'group']),
  groupId: z.string().nullable(),
  // T-0110: the rule's topic scope. Optional so older payloads parse.
  topicId: z.string().nullable().optional(),
  topicName: z.string().nullable().optional(),
  createdAt: z.string(),
  createdBy: z.string(),
});

export type ApprovalRule = z.infer<typeof approvalRuleSchema>;

export function listAiApprovalRules(aiId: string): Promise<ApprovalRule[]> {
  return request(`/ais/${encodeURIComponent(aiId)}/approval-rules`, z.array(approvalRuleSchema));
}

export function listGroupApprovalRules(groupId: string): Promise<ApprovalRule[]> {
  return request(
    `/groups/${encodeURIComponent(groupId)}/approval-rules`,
    z.array(approvalRuleSchema),
  );
}

export async function revokeApprovalRule(id: string): Promise<void> {
  await request(`/approval-rules/${encodeURIComponent(id)}`, z.null(), { method: 'DELETE' });
}

// --- Message search (T-0117) -----------------------------------------------
// The wire contract lives in apps/server/src/search/routes.ts. Snippets
// arrive as plain text plus `marks` ranges; the client highlights with
// spans and never renders HTML.

const searchMarkSchema = z.tuple([z.number().int().min(0), z.number().int().min(0)]);

const searchItemSchema = z.object({
  chatJid: z.string(),
  messageId: z.string(),
  senderName: z.string(),
  at: z.string(),
  snippet: z.string(),
  marks: z.array(searchMarkSchema),
});

export type SearchItem = z.infer<typeof searchItemSchema>;

const searchPageSchema = z.object({
  items: z.array(searchItemSchema),
  nextBefore: z.string().optional(),
});

export interface SearchMessagesInput {
  q: string;
  chat?: string;
  limit?: number;
  before?: string;
  signal?: AbortSignal;
}

async function searchRequest<T>(
  params: URLSearchParams,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  if (isMockApiEnabled()) {
    response = await mockRequest(`/search?${params.toString()}`, { method: 'GET' });
  } else {
    if (signal?.aborted === true) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      response = await fetch(`${API_BASE}/search?${params.toString()}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      throw new ApiError(0, 'network_error', 'Could not reach the server');
    }
  }
  if (signal?.aborted === true) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(raw);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error.code : 'request_failed',
      parsed.success ? parsed.data.error.message : `Request failed (${response.status})`,
    );
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server sent an unexpected response',
    );
  }
  return parsed.data;
}

export function searchMessages(
  input: SearchMessagesInput,
): Promise<{ items: SearchItem[]; nextBefore?: string | undefined }> {
  const params = new URLSearchParams();
  params.set('q', input.q);
  if (input.chat !== undefined && input.chat !== '') {
    params.set('chat', input.chat);
  }
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  if (input.before !== undefined && input.before !== '') {
    params.set('before', input.before);
  }
  return searchRequest(params, searchPageSchema, input.signal);
}

// --- Stickers (T-0120) -----------------------------------------------------
// User-made packs: the panel lists mine in order (with stickers), discover
// lists `server`-visible packs, and files are served same-origin so the
// renderer can auto-load them without leaking the viewer's IP.

export const stickerSchema = z.object({
  id: z.string(),
  packId: z.string(),
  emoji: z.string().nullable(),
  mime: z.enum(['image/webp', 'image/png']),
  width: z.number(),
  height: z.number(),
  bytes: z.number(),
  url: z.string(),
});

export type Sticker = z.infer<typeof stickerSchema>;

export const stickerPackSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  title: z.string(),
  visibility: z.enum(['private', 'server']),
  stickers: z.array(stickerSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type StickerPack = z.infer<typeof stickerPackSchema>;

const stickerPacksSchema = z.object({ packs: z.array(stickerPackSchema) });

const discoverPacksSchema = z.object({
  packs: z.array(stickerPackSchema),
  next: z.string().nullable(),
});

export function listStickerPacks(): Promise<StickerPack[]> {
  return request('/sticker-packs', stickerPacksSchema).then((body) => body.packs);
}

export function createStickerPack(input: {
  title: string;
  visibility?: 'private' | 'server';
}): Promise<StickerPack> {
  return request('/sticker-packs', stickerPackSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function discoverStickerPacks(
  query?: string,
): Promise<{ packs: StickerPack[]; next: string | null }> {
  const params = new URLSearchParams();
  if (query !== undefined && query.trim() !== '') {
    params.set('q', query.trim());
  }
  const suffix = params.size === 0 ? '' : `?${params.toString()}`;
  return request(`/sticker-packs/discover${suffix}`, discoverPacksSchema);
}

export async function addStickerPanelPack(packId: string): Promise<void> {
  await request(`/sticker-panel/${encodeURIComponent(packId)}`, z.object({ ok: z.boolean() }), {
    method: 'PUT',
  });
}

export async function removeStickerPanelPack(packId: string): Promise<void> {
  await request(`/sticker-panel/${encodeURIComponent(packId)}`, z.object({ ok: z.boolean() }), {
    method: 'DELETE',
  });
}

// --- Audit log (T-0079, T-0084) --------------------------------------------
// The wire contract lives in apps/server/src/audit/routes.ts and service.ts.

const auditCostSchema = z
  .object({
    currency: z.enum(['EUR', 'USD']),
    amount: z.number(),
  })
  .nullable();

export const publicAuditEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  aiId: z.string().nullable(),
  groupId: z.string().nullable(),
  action: z.string(),
  subjectId: z.string().nullable(),
  argsHash: z.string().nullable(),
  cost: auditCostSchema,
  result: z.enum(['ok', 'denied', 'error']),
  detail: z.record(z.string(), z.unknown()).nullable(),
  actorUserId: z.string().nullable(),
});

export type PublicAuditEntry = z.infer<typeof publicAuditEntrySchema>;

const auditPageSchema = z.object({
  entries: z.array(publicAuditEntrySchema),
  next: z.string().nullable(),
});

export interface ListAuditPage {
  entries: PublicAuditEntry[];
  next: string | null;
}

// T-0086: the audit endpoint answers one of `?aiId=…` or `?groupId=…`, never
// both, and the server answers 400 otherwise. The discriminated union makes
// "exactly one of the two keys" a compile error: passing both or neither
// fails type-checking.
export type AuditScope =
  { aiId: string; groupId?: undefined } | { groupId: string; aiId?: undefined };

export type ListAuditInput = AuditScope & {
  limit?: number;
  before?: string;
};

export function listAudit(input: ListAuditInput): Promise<ListAuditPage> {
  const params = new URLSearchParams();
  if ('aiId' in input && input.aiId !== undefined) {
    params.set('aiId', input.aiId);
  } else if ('groupId' in input && input.groupId !== undefined) {
    params.set('groupId', input.groupId);
  }
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  if (input.before !== undefined && input.before !== '') {
    params.set('before', input.before);
  }
  return request(`/audit?${params.toString()}`, auditPageSchema);
}
