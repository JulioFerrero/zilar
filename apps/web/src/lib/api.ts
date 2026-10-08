import { Effect, Exit, Schema } from 'effect';
import { FOLDER_ICONS, type FolderChatType, type FolderIcon } from '@zilar/chat-core';
import { struct } from '@zilar/protocol';
import { isMockApiEnabled } from '@/mock/gate';
import { mockRequest } from '@/mock/api';

/** Base path for the server API. The Vite dev server proxies it same-origin. */
export const API_BASE = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Extra fields the server merged into the `error` body (e.g. `nextChangeAt`). */
  readonly detail: Record<string, unknown>;

  constructor(status: number, code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

type ResponseSchema<T> = Schema.Codec<T, unknown>;

/**
 * Decodes one response body with an Effect Schema. The decode is
 * non-strict (unknown keys are dropped).
 */
function decodeResponse<T>(
  schema: ResponseSchema<T>,
  raw: unknown,
): { ok: true; value: T } | { ok: false } {
  const result = Schema.decodeUnknownExit(schema)(raw);
  return Exit.isSuccess(result) ? { ok: true, value: result.value } : { ok: false };
}

const errorBodySchema = struct({
  error: Schema.StructWithRest(Schema.Struct({ code: Schema.String, message: Schema.String }), [
    Schema.Record(Schema.String, Schema.Unknown),
  ]),
});

const meSchema = struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  image: Schema.optional(Schema.NullOr(Schema.String)),
  // T-0163: the caller's own `@username`. Optional (not just nullable) so
  // payloads from an older server still parse — absent reads like null.
  handle: Schema.optional(Schema.NullOr(Schema.String)),
  // T-0165: the caller's own picture, when set. Optional so older payloads
  // parse (treated as none).
  avatarUrl: Schema.optional(Schema.String),
  jid: Schema.optional(Schema.NullOr(Schema.String)),
});

export type Me = typeof meSchema.Type;

const contactSchema = struct({
  userId: Schema.String,
  name: Schema.String,
  jid: Schema.String,
  avatarUrl: Schema.optional(Schema.String),
  // T-0163: the contact's `@username`. Optional so payloads from an older
  // server still parse (treated as none).
  handle: Schema.optional(Schema.NullOr(Schema.String)),
});

export type Contact = typeof contactSchema.Type;

const dmEntrySchema = struct({
  kind: Schema.Literal('dm'),
  chatJid: Schema.String,
  title: Schema.String,
  userId: Schema.optional(Schema.String),
  avatarUrl: Schema.optional(Schema.String),
  /** Set on the caller's AIs; absent or false for human contacts. */
  isAi: Schema.optional(Schema.Boolean),
});

// T-0466: the group's shared background, set by owners/admins. Optional on
// entries and details so payloads from an older server still parse.
const groupBackgroundSchema = struct({
  backgroundPreset: Schema.NullOr(Schema.String),
  backgroundImageId: Schema.NullOr(Schema.String),
  backgroundDim: Schema.NullOr(Schema.Number),
});

export type GroupBackground = typeof groupBackgroundSchema.Type;

const groupEntrySchema = struct({
  kind: Schema.Literal('group'),
  chatJid: Schema.String,
  title: Schema.String,
  groupId: Schema.String,
  memberCount: Schema.Number,
  role: Schema.Literals(['owner', 'admin', 'member']),
  // T-0124: `group` behaves as before; `channel` is the broadcast feed (its
  // General topic is the feed). Optional so older payloads parse as groups.
  chatKind: Schema.optional(Schema.Literals(['group', 'channel'])),
  // T-0124: the same count under the usual channel name, for channels only.
  subscriberCount: Schema.optional(Schema.Number),
  // T-0124: the channel's short blurb. Optional so older payloads parse.
  description: Schema.optional(Schema.NullOr(Schema.String)),
  // T-0164: `public` groups are in the directory; `private` stay
  // invite-only. Optional so older payloads parse as private.
  visibility: Schema.optional(Schema.Literals(['private', 'public'])),
  // T-0164: the group's `@handle` while public, null while private.
  // Optional so older payloads parse as none.
  handle: Schema.optional(Schema.NullOr(Schema.String)),
  // T-0111: present on servers with topics (T-0108); absent on older ones.
  // Parsed loosely here — each entry is validated by `topicSchema` when
  // mapping to chats — and unknown entries are dropped there.
  topics: Schema.optional(Schema.mutable(Schema.Array(Schema.Unknown))),
  // T-0165: the group's picture, when it has one. Optional so older
  // payloads parse (treated as none).
  avatarUrl: Schema.optional(Schema.String),
  // T-0466: the group's shared background. Optional so older payloads parse.
  background: Schema.optional(groupBackgroundSchema),
});

const chatEntrySchema = Schema.Union([dmEntrySchema, groupEntrySchema]);

export type ChatEntry = typeof chatEntrySchema.Type;

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
    const parsed = decodeResponse(topicSchema, raw);
    if (parsed.ok) {
      result.push(parsed.value);
    }
  }
  return result;
}

const chatsSchema = struct({ chats: Schema.mutable(Schema.Array(chatEntrySchema)) });

const groupMemberSchema = struct({
  userId: Schema.String,
  name: Schema.String,
  role: Schema.Literals(['owner', 'admin', 'member']),
  // T-0163: the member's `@username`. Optional so payloads from an older
  // server still parse (treated as none).
  handle: Schema.optional(Schema.NullOr(Schema.String)),
  // T-0116: the custom group roles this member holds. Optional so payloads
  // from an older server still parse (treated as none).
  roles: Schema.optional(
    Schema.mutable(Schema.Array(struct({ id: Schema.String, name: Schema.String }))),
  ),
  // T-0165: the member's picture. Optional so older payloads parse.
  avatarUrl: Schema.optional(Schema.String),
});

const groupAiSchema = struct({
  aiId: Schema.String,
  jid: Schema.String,
  name: Schema.String,
  ownerId: Schema.String,
  // T-0165: the AI's picture. Optional so older payloads parse.
  avatarUrl: Schema.optional(Schema.String),
});

// T-0478: the group's AI listener. `available` is the server's
// `LISTENER_ENABLED` flag: when false the controls stay disabled. Optional
// on details so payloads from an older server still parse.
const groupListenerSchema = struct({
  enabled: Schema.Boolean,
  eagerness: Schema.Literals(['quiet', 'normal', 'eager']),
  available: Schema.Boolean,
});

export type ListenerEagerness = (typeof groupListenerSchema.Type)['eagerness'];

const groupDetailSchema = struct({
  id: Schema.String,
  title: Schema.String,
  createdBy: Schema.String,
  // T-0108: plain members may create topics when the switch is on. Optional
  // so payloads from an older server still parse (treated as off).
  membersCanCreateTopics: Schema.optional(Schema.Boolean),
  // T-0124: `channel` is the broadcast feed. Optional so older payloads
  // parse as groups.
  kind: Schema.optional(Schema.Literals(['group', 'channel'])),
  // T-0124: the channel's short blurb. Optional so older payloads parse.
  description: Schema.optional(Schema.NullOr(Schema.String)),
  // T-0164: `public` groups hold exactly one handle row and appear in the
  // directory; `private` stay invite-only. Optional so older payloads parse
  // as private.
  visibility: Schema.optional(Schema.Literals(['private', 'public'])),
  // T-0164: the group's `@handle` while public, null while private.
  // Optional so older payloads parse as none.
  handle: Schema.optional(Schema.NullOr(Schema.String)),
  // T-0165: the group's picture. Optional so older payloads parse.
  avatarUrl: Schema.optional(Schema.String),
  // T-0466: the group's shared background. Optional so older payloads parse.
  background: Schema.optional(groupBackgroundSchema),
  // T-0478: the AI listener switch and eagerness. Optional so older
  // payloads parse (treated as off and unavailable).
  listener: Schema.optional(groupListenerSchema),
  members: Schema.mutable(Schema.Array(groupMemberSchema)),
  ais: Schema.mutable(Schema.Array(groupAiSchema)),
});

export type GroupMember = typeof groupMemberSchema.Type;
export type GroupAi = typeof groupAiSchema.Type;
export type GroupDetail = typeof groupDetailSchema.Type;

const inviteSchema = struct({
  code: Schema.String,
  url: Schema.String,
  expiresAt: Schema.optional(Schema.String),
});

export type Invite = typeof inviteSchema.Type;

const xmppTokenSchema = struct({
  jid: Schema.String,
  token: Schema.String,
  expiresAt: Schema.String,
  service: Schema.String,
  domain: Schema.String,
  mucDomain: Schema.String,
});

export type XmppToken = typeof xmppTokenSchema.Type;

async function request<T>(
  path: string,
  schema: ResponseSchema<T>,
  init: RequestInit = {},
): Promise<T> {
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
    throw toApiError(response.status, raw);
  }

  const parsed = decodeResponse(schema, raw);
  if (!parsed.ok) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server sent an unexpected response',
    );
  }
  return parsed.value;
}

// Builds the ApiError for a failed response: `code`/`message` plus any
// extra body fields on `detail` (e.g. `nextChangeAt`), minus the `requestId`
// the server adds for tracing.
function toApiError(status: number, raw: unknown): ApiError {
  const parsed = decodeResponse(errorBodySchema, raw);
  if (!parsed.ok) {
    return new ApiError(status, 'request_failed', `Request failed (${status})`);
  }
  const { code, message, requestId: _requestId, ...detail } = parsed.value.error;
  void _requestId;
  return new ApiError(status, code, message, detail as Record<string, unknown>);
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
  return request('/contacts', Schema.mutable(Schema.Array(contactSchema)));
}

export function createGroup(input: {
  title: string;
  memberIds: string[];
  // T-0124: `channel` creates the broadcast feed (moderated room).
  kind?: 'group' | 'channel';
  // T-0124: the channel's short blurb (≤ 300).
  description?: string;
}): Promise<GroupDetail> {
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
  return request(`/invites/${encodeURIComponent(code)}`, struct({ valid: Schema.Boolean }));
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
export const topicKindSchema = Schema.Literals(['chat', 'task', 'bug', 'ui', 'routine']);

export type TopicKind = typeof topicKindSchema.Type;

export const topicStatusSchema = Schema.Literals([
  'open',
  'in_progress',
  'in_review',
  'blocked',
  'done',
]);

export type TopicStatus = typeof topicStatusSchema.Type;

export const topicVisibilitySchema = Schema.Literals(['public', 'private']);

export type TopicVisibility = typeof topicVisibilitySchema.Type;

export const topicOwnerSchema = struct({
  kind: Schema.Literals(['user', 'ai']),
  id: Schema.String,
  name: Schema.String,
});

export type TopicOwner = typeof topicOwnerSchema.Type;

export const topicAiSchema = struct({
  id: Schema.String,
  name: Schema.String,
});

export type TopicAi = typeof topicAiSchema.Type;

// T-0116: a custom group role attached to a topic (`roles`) or named as its
// approver (`approverRole`). `memberCount` counts current holders.
export const topicRoleSchema = struct({
  id: Schema.String,
  name: Schema.String,
  memberCount: Schema.Number,
});

export type TopicRole = typeof topicRoleSchema.Type;

export const approverRoleSchema = struct({
  id: Schema.String,
  name: Schema.String,
});

export type ApproverRole = typeof approverRoleSchema.Type;

export const topicSchema = struct({
  id: Schema.String,
  groupId: Schema.String,
  name: Schema.String,
  glyph: Schema.String,
  chatJid: Schema.String,
  visibility: topicVisibilitySchema,
  kind: topicKindSchema,
  status: topicStatusSchema,
  owner: Schema.NullOr(topicOwnerSchema),
  linkUrl: Schema.NullOr(Schema.String),
  linkLabel: Schema.NullOr(Schema.String),
  isGeneral: Schema.Boolean,
  archived: Schema.Boolean,
  memberCount: Schema.Number,
  ais: Schema.mutable(Schema.Array(topicAiSchema)),
  // T-0116: roles with access and the approver role. Optional so payloads
  // from an older server still parse (treated as none).
  roles: Schema.optional(Schema.mutable(Schema.Array(topicRoleSchema))),
  approverRole: Schema.optional(Schema.NullOr(approverRoleSchema)),
});

export type Topic = typeof topicSchema.Type;

export const topicMemberSchema = struct({
  userId: Schema.String,
  name: Schema.String,
});

export type TopicMember = typeof topicMemberSchema.Type;

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
    struct({ topics: Schema.mutable(Schema.Array(topicSchema)) }),
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
    struct({ members: Schema.mutable(Schema.Array(topicMemberSchema)) }),
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
    struct({ ais: Schema.mutable(Schema.Array(topicAiSchema)) }),
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

export const groupRoleMemberSchema = struct({
  userId: Schema.String,
  name: Schema.String,
});

export type GroupRoleMember = typeof groupRoleMemberSchema.Type;

export const groupRoleSchema = struct({
  id: Schema.String,
  name: Schema.String,
  members: Schema.mutable(Schema.Array(groupRoleMemberSchema)),
});

export type GroupRole = typeof groupRoleSchema.Type;

export function listGroupRoles(groupId: string): Promise<GroupRole[]> {
  return request(
    `/groups/${encodeURIComponent(groupId)}/roles`,
    struct({ roles: Schema.mutable(Schema.Array(groupRoleSchema)) }),
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
    Schema.Null,
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

export interface SetGroupListenerInput {
  listenerEnabled?: boolean;
  listenerEagerness?: ListenerEagerness;
}

// T-0478: owners/admins turn the group's AI listener on/off and pick an
// eagerness. A member gets 403.
export function setGroupListener(
  groupId: string,
  input: SetGroupListenerInput,
): Promise<GroupDetail> {
  return request(`/groups/${encodeURIComponent(groupId)}`, groupDetailSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

// T-0466: owners and admins set the group's shared background. A member gets
// 403; `null` fields clear them.
export function setGroupBackground(
  groupId: string,
  background: GroupBackground,
): Promise<GroupDetail> {
  return request(`/groups/${encodeURIComponent(groupId)}`, groupDetailSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ background }),
  });
}

// Web UI helper for T-0111: the panel shows the rules of one topic, read
// through the existing per-group list (each row carries its `topicId`).
// Declared as a type alias (not a const) because the approval schemas are
// defined further below in this file.
export type TopicApprovalRule = typeof approvalRuleSchema.Type;

// --- Channels (T-0124) -------------------------------------------------------
// One-way broadcast feeds: only owner/admins post (the room is moderated and
// subscribers are visitors), everyone else subscribes, reads and mutes. A
// channel is a group with one feed (its General topic): no more topics, and
// the member list is visible to admins only (subscribers see the count).
export const groupMemberListSchema = struct({
  members: Schema.mutable(Schema.Array(groupMemberSchema)),
});

export function listGroupMembers(groupId: string): Promise<GroupMember[]> {
  return request(`/groups/${encodeURIComponent(groupId)}/members`, groupMemberListSchema).then(
    ({ members }) => members,
  );
}

// Only the owner may promote a member to admin (or demote one back). The
// room affiliation follows at once, so a channel's voice mapping is enforced
// by the room. Demoting the last admin answers 409 `channel_needs_admin`.
export function changeGroupMemberRole(
  groupId: string,
  userId: string,
  role: 'admin' | 'member',
): Promise<GroupDetail> {
  return request(
    `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/role`,
    groupDetailSchema,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    },
  );
}

export function removeGroupMember(groupId: string, userId: string): Promise<GroupDetail> {
  return request(
    `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
    groupDetailSchema,
    { method: 'DELETE' },
  );
}

export function listTopicApprovalRules(groupId: string): Promise<TopicApprovalRule[]> {
  return listGroupApprovalRules(groupId);
}

export const topicToolSchema = struct({
  id: Schema.String,
  aiId: Schema.String,
  groupId: Schema.NullOr(Schema.String),
  topicId: Schema.NullOr(Schema.String),
  name: Schema.String,
  description: Schema.String,
  currentVersion: Schema.Number,
  hosts: Schema.mutable(Schema.Array(Schema.String)),
  lastRunStatus: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});

export type TopicTool = typeof topicToolSchema.Type;

export function listTopicTools(topicId: string): Promise<TopicTool[]> {
  return request(
    `/topics/${encodeURIComponent(topicId)}/tools`,
    Schema.mutable(Schema.Array(topicToolSchema)),
  );
}

// --- Group invite links (T-0115) -------------------------------------------
// Shareable links that join a group as `member` (`${WEB}/j/<token>` on the
// web). The token is shown once at creation and never stored — the list
// below carries hints, labels, uses and state, never tokens.
export const groupInviteLinkSchema = struct({
  id: Schema.String,
  label: Schema.NullOr(Schema.String),
  tokenHint: Schema.String,
  uses: Schema.Number,
  maxUses: Schema.NullOr(Schema.Number),
  expiresAt: Schema.NullOr(Schema.String),
  revoked: Schema.Boolean,
  createdAt: Schema.String,
});

export type GroupInviteLink = typeof groupInviteLinkSchema.Type;

const groupInviteLinksSchema = struct({
  links: Schema.mutable(Schema.Array(groupInviteLinkSchema)),
});

const createdInviteLinkSchema = struct({
  id: Schema.String,
  token: Schema.String,
  url: Schema.String,
});

export type CreatedInviteLink = typeof createdInviteLinkSchema.Type;

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
    Schema.Null,
    { method: 'DELETE' },
  );
}

// --- Join by link (T-0115) -------------------------------------------------
// The preview names the group and counts its members — never member names,
// and never the group id unless the caller is already a member (they know
// it; the join page opens the group chat with it). Joining adds the caller
// as `member` and returns the group id; an existing member answers
// `alreadyMember: true` without consuming a use.

export const joinPreviewSchema = struct({
  groupTitle: Schema.String,
  memberCount: Schema.Number,
  alreadyMember: Schema.Boolean,
  groupId: Schema.optional(Schema.String),
  // T-0124: `channel` previews read "Join channel" (and count subscribers);
  // absent on older servers = a group.
  kind: Schema.optional(Schema.Literals(['group', 'channel'])),
});

export type JoinPreview = typeof joinPreviewSchema.Type;

const joinResultSchema = struct({
  groupId: Schema.String,
  alreadyMember: Schema.Boolean,
});

export type JoinResult = typeof joinResultSchema.Type;

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

const chatPrefSchema = struct({
  chatJid: Schema.String,
  mutedUntil: Schema.NullOr(Schema.String),
  archived: Schema.Boolean,
  pinnedAt: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
  // T-0461: per-chat background override (T-0458). All null when the chat
  // inherits the caller's global default.
  backgroundPreset: Schema.optional(Schema.NullOr(Schema.String)),
  backgroundImageId: Schema.optional(Schema.NullOr(Schema.String)),
  backgroundDim: Schema.optional(Schema.NullOr(Schema.Number)),
});

export type ChatPref = typeof chatPrefSchema.Type;

const chatPrefsSchema = struct({ prefs: Schema.mutable(Schema.Array(chatPrefSchema)) });

export interface PutChatPrefInput {
  mutedUntil?: string | null | undefined;
  archived?: boolean | undefined;
  pinned?: boolean | undefined;
  // T-0462: per-chat background override fields. A null clears that field,
  // an omitted field leaves it untouched; preset and image are exclusive.
  backgroundPreset?: string | null | undefined;
  backgroundImageId?: string | null | undefined;
  backgroundDim?: number | null | undefined;
}

export function listChatPrefs(): Promise<ChatPref[]> {
  return request('/chat-prefs', chatPrefsSchema).then((body) => body.prefs);
}

// T-0461: the caller's global chat background default (T-0458). `GET
// /chat-background` returns it under `defaultBackground`; all-null means the
// caller never chose one, so chats fall back to the slate grid.
const chatBackgroundChoiceSchema = struct({
  backgroundPreset: Schema.NullOr(Schema.String),
  backgroundImageId: Schema.NullOr(Schema.String),
  backgroundDim: Schema.NullOr(Schema.Number),
});

export type ChatBackgroundChoice = typeof chatBackgroundChoiceSchema.Type;

export function getChatBackgroundDefault(): Promise<ChatBackgroundChoice> {
  return request(
    '/chat-background',
    struct({ defaultBackground: chatBackgroundChoiceSchema }),
  ).then((body) => body.defaultBackground);
}

// T-0462: write the caller's global background default. The body carries the
// same three fields as the per-chat patch and the reply is the saved default.
export function putChatBackgroundDefault(
  input: ChatBackgroundChoice,
): Promise<ChatBackgroundChoice> {
  return request('/chat-background', struct({ defaultBackground: chatBackgroundChoiceSchema }), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((body) => body.defaultBackground);
}

export async function putChatPref(
  chatJid: string,
  input: PutChatPrefInput,
): Promise<ChatPref | null> {
  const raw: unknown = await request(
    `/chat-prefs/${encodeURIComponent(chatJid)}`,
    Schema.Union([chatPrefSchema, struct({ prefs: Schema.Null })]),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  if (typeof raw === 'object' && raw !== null && 'prefs' in raw) {
    return null;
  }
  return Schema.decodeUnknownSync(chatPrefSchema)(raw);
}

// --- Chat folders (T-0237) ---------------------------------------------------
// Folders come from the server (`apps/server/src/chat-folders/routes.ts`);
// the client only lists and syncs them here (create/rename/delete/reorder
// UI is T-0238). The wire shape mirrors `ChatFolder` in chat-core.

const folderChatTypeSchema = Schema.Literals(['dm', 'group', 'channel', 'ai']);
const folderIconSchema = Schema.Literals(FOLDER_ICONS);

export const chatFolderSchema = struct({
  id: Schema.String,
  name: Schema.String,
  icon: folderIconSchema,
  position: Schema.Number,
  includeTypes: Schema.mutable(Schema.Array(folderChatTypeSchema)),
  includeChats: Schema.mutable(Schema.Array(Schema.String)),
  excludeChats: Schema.mutable(Schema.Array(Schema.String)),
  excludeMuted: Schema.Boolean,
  excludeRead: Schema.Boolean,
});

export type ApiChatFolder = typeof chatFolderSchema.Type;

const chatFoldersSchema = struct({
  folders: Schema.mutable(Schema.Array(chatFolderSchema)),
});
const chatFolderResultSchema = struct({ folder: chatFolderSchema });
const chatFolderDeletedSchema = struct({ deleted: Schema.Literal(true) });

export interface CreateChatFolderInput {
  name: string;
  icon: FolderIcon;
  includeTypes?: FolderChatType[] | undefined;
  includeChats?: string[] | undefined;
  excludeChats?: string[] | undefined;
  excludeMuted?: boolean | undefined;
  excludeRead?: boolean | undefined;
}

export type PatchChatFolderInput = Partial<CreateChatFolderInput>;

export function listChatFolders(): Promise<ApiChatFolder[]> {
  return request('/chat-folders', chatFoldersSchema).then((body) => body.folders);
}

export function createChatFolder(input: CreateChatFolderInput): Promise<ApiChatFolder> {
  return request('/chat-folders', chatFolderResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((body) => body.folder);
}

export function patchChatFolder(id: string, input: PatchChatFolderInput): Promise<ApiChatFolder> {
  return request(`/chat-folders/${encodeURIComponent(id)}`, chatFolderResultSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((body) => body.folder);
}

export function reorderChatFolders(ids: string[]): Promise<ApiChatFolder[]> {
  return request('/chat-folders/order', chatFoldersSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  }).then((body) => body.folders);
}

export async function deleteChatFolder(id: string): Promise<void> {
  await request(`/chat-folders/${encodeURIComponent(id)}`, chatFolderDeletedSchema, {
    method: 'DELETE',
  });
}

// --- Pinned messages (T-0114) ------------------------------------------------
// The wire contract lives in apps/server/src/pins/{routes,service,access}.
// `chat` is a room bare JID for groups/topics, or a DM peer's bare JID (the
// server keeps the canonical pair key, so both sides share one list). Pins
// arrive newest first. The snapshot (`senderName`/`text`/`kind`) is display
// only: the server trusts it for rendering, never for authorization.

export const pinKindSchema = Schema.Literals(['text', 'image', 'file', 'voice', 'card']);

export type PinKind = typeof pinKindSchema.Type;

export const pinSchema = struct({
  id: Schema.String,
  chat: Schema.String,
  messageId: Schema.String,
  senderName: Schema.String,
  text: Schema.String,
  kind: pinKindSchema,
  pinnedBy: Schema.String,
  pinnedAt: Schema.String,
});

export type Pin = typeof pinSchema.Type;

const pinsSchema = struct({ pins: Schema.mutable(Schema.Array(pinSchema)) });

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

// --- AI memory (T-0443) ------------------------------------------------------
// The wire contract lives in apps/server/src/agents/memory/routes.ts. `chat`
// is the DM peer's bare JID (the AI's JID in a DM); `aiId` is the AI's id. The
// server answers the pinned facts and the cover lines; `canChange` is false
// for a room member who may only view.

const aiMemoryFactSchema = struct({
  id: Schema.String,
  text: Schema.String,
});

export const aiMemorySchema = struct({
  facts: Schema.mutable(Schema.Array(aiMemoryFactSchema)),
  lines: Schema.mutable(Schema.Array(Schema.String)),
  canChange: Schema.Boolean,
});

export type AiMemory = typeof aiMemorySchema.Type;

const okResponseSchema = struct({ ok: Schema.Literal(true) });

export function getAiMemory(chat: string, aiId: string): Promise<AiMemory> {
  const params = new URLSearchParams();
  params.set('chat', chat);
  params.set('ai', aiId);
  return request(`/ai-memory?${params.toString()}`, aiMemorySchema);
}

export async function forgetAiMemoryFact(
  chat: string,
  aiId: string,
  factId: string,
): Promise<void> {
  const params = new URLSearchParams();
  params.set('chat', chat);
  params.set('ai', aiId);
  await request(
    `/ai-memory/facts/${encodeURIComponent(factId)}?${params.toString()}`,
    okResponseSchema,
    {
      method: 'DELETE',
    },
  );
}

export async function clearAiMemory(chat: string, aiId: string): Promise<void> {
  await request('/ai-memory/clear', okResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat, ai: aiId }),
  });
}

// --- Media gallery (T-0434) --------------------------------------------------
// The wire contract lives in apps/server/src/media/routes.ts. `chat` is a room
// bare JID for groups/topics, or a DM peer's bare JID. `type` maps to a panel
// tab; `before` is the `next` cursor of the previous page (microseconds as a
// string). Items arrive newest first.

export const mediaTabSchema = Schema.Literals(['media', 'files', 'links', 'voice']);

export type MediaTab = typeof mediaTabSchema.Type;

export const mediaItemSchema = struct({
  messageId: Schema.String,
  chat: Schema.String,
  at: Schema.String,
  senderName: Schema.String,
  kind: Schema.Literals(['image', 'file', 'gif', 'voice', 'link']),
  url: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  size: Schema.optional(Schema.Number),
  mime: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
  durationMs: Schema.optional(Schema.Number),
  waveform: Schema.optional(Schema.mutable(Schema.Array(Schema.Number))),
  linkUrl: Schema.optional(Schema.String),
  linkHost: Schema.optional(Schema.String),
});

export type MediaItem = typeof mediaItemSchema.Type;

export const mediaPageSchema = struct({
  items: Schema.mutable(Schema.Array(mediaItemSchema)),
  next: Schema.NullOr(Schema.String),
});

export type MediaPage = typeof mediaPageSchema.Type;

export interface ListChatMediaInput {
  chat: string;
  type: MediaTab;
  before?: string;
  limit?: number;
}

export function listChatMedia(input: ListChatMediaInput): Promise<MediaPage> {
  const params = new URLSearchParams();
  params.set('chat', input.chat);
  params.set('type', input.type);
  if (input.before !== undefined) {
    params.set('before', input.before);
  }
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  return request(`/media?${params.toString()}`, mediaPageSchema);
}

// --- AIs (T-0032) --------------------------------------------------------
// The wire contract lives in apps/server/src/ais/routes.ts and service.ts.
// `ApiError` already carries the server's `code` and `status`, so callers can
// branch without parsing the message again.

const aiTemplateSchema = Schema.Literals(['dev', 'marketing', 'fun', 'custom']);

export type AiTemplate = typeof aiTemplateSchema.Type;

const aiLimitsSchema = struct({
  perDayUsd: Schema.Number,
  perMonthUsd: Schema.Number,
});

export type AiLimits = typeof aiLimitsSchema.Type;

// T-0058: the AI's spend summary. Optional (not just nullable) so responses
// from older servers still parse; absent means "unavailable" like null.
const aiUsageSchema = struct({
  todayUsd: Schema.Number,
  windowUsd: Schema.Number,
});

export type AiUsage = typeof aiUsageSchema.Type;

const publicAiSchema = struct({
  id: Schema.String,
  name: Schema.String,
  template: aiTemplateSchema,
  persona: Schema.String,
  model: Schema.String,
  jid: Schema.String,
  // `stopped` is the owner kill switch (T-0080): the AI is paused, not
  // deleted, and a resume brings it back.
  status: Schema.Literals(['active', 'disabled', 'stopped']),
  providerConnectionId: Schema.String,
  limits: aiLimitsSchema,
  usage: Schema.optional(Schema.NullOr(aiUsageSchema)),
  // T-0091: the AI's home machine id, or null when it runs on the platform.
  // Optional so a payload from a server that has not been upgraded yet
  // still parses — the panel renders the same way when it is absent.
  machineId: Schema.optional(Schema.NullOr(Schema.String)),
  // T-0165: the AI's picture, when it has one. Optional so older payloads
  // parse (treated as none).
  avatarUrl: Schema.optional(Schema.String),
  // T-0478: the owner's delegation opt-ins. Optional so older payloads parse
  // (treated as off).
  canDelegate: Schema.optional(Schema.Boolean),
  acceptsDelegation: Schema.optional(Schema.Boolean),
  createdAt: Schema.String,
});

export type PublicAi = typeof publicAiSchema.Type;

const connectionSchema = struct({
  id: Schema.String,
  provider: Schema.String,
  label: Schema.NullOr(Schema.String),
  status: Schema.String,
  createdAt: Schema.String,
});

export type Connection = typeof connectionSchema.Type;

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
  // T-0478: the owner's delegation opt-ins.
  canDelegate?: boolean;
  acceptsDelegation?: boolean;
}

export function listAis(): Promise<PublicAi[]> {
  return request('/ais', Schema.mutable(Schema.Array(publicAiSchema)));
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
  await request(`/ais/${encodeURIComponent(id)}`, Schema.Null, { method: 'DELETE' });
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
  return request('/connections', Schema.mutable(Schema.Array(connectionSchema)));
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

const connectionTestResultSchema = struct({
  ok: Schema.Boolean,
  message: Schema.optional(Schema.String),
});

export type ConnectionTestResult = typeof connectionTestResultSchema.Type;

export function testConnection(id: string): Promise<ConnectionTestResult> {
  return request(`/connections/${encodeURIComponent(id)}/test`, connectionTestResultSchema, {
    method: 'POST',
  });
}

export async function deleteConnection(id: string): Promise<void> {
  await request(`/connections/${encodeURIComponent(id)}`, Schema.Null, { method: 'DELETE' });
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

const machineStatusSchema = Schema.Literals(['pending', 'approved', 'revoked']);

export const machineSchema = struct({
  id: Schema.String,
  name: Schema.String,
  status: machineStatusSchema,
  os: Schema.String,
  osVersion: Schema.String,
  arch: Schema.String,
  cpu: Schema.String,
  cores: Schema.Number,
  ramGb: Schema.Number,
  diskFreeGb: Schema.Number,
  drivers: Schema.mutable(Schema.Array(Schema.String)),
  fingerprint: Schema.String,
  createdAt: Schema.String,
  approvedAt: Schema.NullOr(Schema.String),
  lastSeenAt: Schema.NullOr(Schema.String),
  online: Schema.optional(Schema.Boolean),
});

export interface PairingCode {
  code: string;
  expiresAt: string;
}

const pairingCodeSchema = struct({
  code: Schema.String,
  expiresAt: Schema.String,
});

export function listMachines(): Promise<Machine[]> {
  return request('/machines', Schema.mutable(Schema.Array(machineSchema)));
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
  await request(`/machines/${encodeURIComponent(id)}/deny`, Schema.Null, { method: 'POST' });
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
  await request(`/machines/${encodeURIComponent(id)}`, Schema.Null, { method: 'DELETE' });
}

// --- Approvals (T-0076) ---------------------------------------------------
// The wire contract lives in apps/server/src/approvals/routes.ts and
// service.ts. Dates arrive as ISO strings; we keep them as strings so the
// types line up with `ApprovalRequest.expires_at` and we don't have to think
// about zod's string-to-Date coercion in tests.

export type ApprovalStatus =
  'pending' | 'approved_once' | 'approved_always' | 'denied' | 'consumed' | 'expired';

export type ApprovalDecision = 'approve_once' | 'approve_always' | 'deny';

const approvalWorstCaseSchema = Schema.NullOr(
  struct({
    currency: Schema.Literals(['EUR', 'USD']),
    amount: Schema.Number,
  }),
);

export const publicApprovalSchema = struct({
  id: Schema.String,
  aiId: Schema.String,
  groupId: Schema.NullOr(Schema.String),
  // T-0110: the topic the approval belongs to. Optional so older payloads
  // parse (a missing topic reads like a group approval).
  topicId: Schema.optional(Schema.NullOr(Schema.String)),
  topicName: Schema.optional(Schema.NullOr(Schema.String)),
  action: Schema.String,
  summary: Schema.String,
  details: Schema.NullOr(Schema.String),
  argsHash: Schema.String,
  worstCase: approvalWorstCaseSchema,
  requestedBy: Schema.String,
  status: Schema.Literals([
    'pending',
    'approved_once',
    'approved_always',
    'denied',
    'consumed',
    'expired',
  ]),
  decidedAt: Schema.NullOr(Schema.String),
  note: Schema.NullOr(Schema.String),
  expiresAt: Schema.String,
  createdAt: Schema.String,
  // T-0100: whether `approve_always` is a real choice for this action.
  // Optional with a `false` default so a payload from a server that has not
  // been upgraded yet still parses — the card just hides the third button.
  alwaysEligible: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(false))),
  // T-0134/T-0141: display names of the holders of the topic's approver
  // role, resolved server-side in one batched query per list so the card
  // never fetches the topic per approval (N+1). Optional with an empty
  // default so payloads from an older server still parse — the card hides
  // the approver line.
  approverNames: Schema.mutable(Schema.Array(Schema.String)).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
});

export type PublicApproval = typeof publicApprovalSchema.Type;

export function getApproval(id: string): Promise<PublicApproval> {
  return request(`/approvals/${encodeURIComponent(id)}`, publicApprovalSchema);
}

// T-0081: the inbox page lists everything pending. The server already filters
// by pending, unexpired, decidable by the caller, newest first, max 100.
export function listApprovals(): Promise<PublicApproval[]> {
  return request('/approvals', Schema.mutable(Schema.Array(publicApprovalSchema)));
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

export const approvalRuleSchema = struct({
  id: Schema.String,
  action: Schema.String,
  scope: Schema.Literals(['personal', 'group']),
  groupId: Schema.NullOr(Schema.String),
  // T-0110: the rule's topic scope. Optional so older payloads parse.
  topicId: Schema.optional(Schema.NullOr(Schema.String)),
  topicName: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  createdBy: Schema.String,
});

export type ApprovalRule = typeof approvalRuleSchema.Type;

export function listAiApprovalRules(aiId: string): Promise<ApprovalRule[]> {
  return request(
    `/ais/${encodeURIComponent(aiId)}/approval-rules`,
    Schema.mutable(Schema.Array(approvalRuleSchema)),
  );
}

export function listGroupApprovalRules(groupId: string): Promise<ApprovalRule[]> {
  return request(
    `/groups/${encodeURIComponent(groupId)}/approval-rules`,
    Schema.mutable(Schema.Array(approvalRuleSchema)),
  );
}

export async function revokeApprovalRule(id: string): Promise<void> {
  await request(`/approval-rules/${encodeURIComponent(id)}`, Schema.Null, { method: 'DELETE' });
}

// --- Message search (T-0117) -----------------------------------------------
// The wire contract lives in apps/server/src/search/routes.ts. Snippets
// arrive as plain text plus `marks` ranges; the client highlights with
// spans and never renders HTML.

const searchMarkSchema = Schema.mutable(
  Schema.Tuple([
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  ]),
);

const searchItemSchema = struct({
  chatJid: Schema.String,
  messageId: Schema.String,
  senderName: Schema.String,
  at: Schema.String,
  snippet: Schema.String,
  marks: Schema.mutable(Schema.Array(searchMarkSchema)),
});

export type SearchItem = typeof searchItemSchema.Type;

const searchPageSchema = struct({
  items: Schema.mutable(Schema.Array(searchItemSchema)),
  nextBefore: Schema.optional(Schema.String),
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
  schema: ResponseSchema<T>,
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
    throw toApiError(response.status, raw);
  }
  const parsed = decodeResponse(schema, raw);
  if (!parsed.ok) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server sent an unexpected response',
    );
  }
  return parsed.value;
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
export const stickerSchema = struct({
  id: Schema.String,
  packId: Schema.String,
  emoji: Schema.NullOr(Schema.String),
  mime: Schema.Literals(['image/webp', 'image/png']),
  width: Schema.Number,
  height: Schema.Number,
  bytes: Schema.Number,
  url: Schema.String,
});

export type Sticker = typeof stickerSchema.Type;

export const stickerPackSchema = struct({
  id: Schema.String,
  ownerId: Schema.String,
  title: Schema.String,
  visibility: Schema.Literals(['private', 'server']),
  // Set by the Telegram importer (`telegram:<name>`); absent otherwise.
  importedFrom: Schema.optional(Schema.String),
  stickers: Schema.mutable(Schema.Array(stickerSchema)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type StickerPack = typeof stickerPackSchema.Type;

const stickerPacksSchema = struct({ packs: Schema.mutable(Schema.Array(stickerPackSchema)) });

const discoverPacksSchema = struct({
  packs: Schema.mutable(Schema.Array(stickerPackSchema)),
  next: Schema.NullOr(Schema.String),
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
  await request(`/sticker-panel/${encodeURIComponent(packId)}`, struct({ ok: Schema.Boolean }), {
    method: 'PUT',
  });
}

export async function removeStickerPanelPack(packId: string): Promise<void> {
  await request(`/sticker-panel/${encodeURIComponent(packId)}`, struct({ ok: Schema.Boolean }), {
    method: 'DELETE',
  });
}

// --- Push notifications (T-0119) -------------------------------------------
// The wire contract lives in apps/server/src/push/routes.ts. The browser
// registers its Web Push subscription, stores it, then enables the push
// pair over its own XMPP session (ejabberd requires the enable IQ from the
// user's session). The device list carries labels and dates only — never
// the endpoint URL or keys.

const pushConfigSchema = struct({
  vapidPublicKey: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  pushJid: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
});

export type PushConfig = typeof pushConfigSchema.Type;

const registeredDeviceSchema = struct({
  id: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  node: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  jid: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
});

export type RegisteredDevice = typeof registeredDeviceSchema.Type;

const pushDeviceSchema = struct({
  id: Schema.String,
  userAgent: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
  inactive: Schema.Boolean,
});

export type PushDevice = typeof pushDeviceSchema.Type;

const pushDevicesSchema = struct({ devices: Schema.mutable(Schema.Array(pushDeviceSchema)) });

const pushSettingsSchema = struct({ showPreviews: Schema.Boolean });

export function getPushConfig(): Promise<PushConfig> {
  return request('/push/config', pushConfigSchema);
}

export interface RegisterPushDeviceInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | undefined;
}

export function registerPushDevice(input: RegisterPushDeviceInput): Promise<RegisteredDevice> {
  return request('/push/subscriptions', registeredDeviceSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: input.endpoint,
      keys: input.keys,
      ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
    }),
  });
}

export function listPushDevices(): Promise<PushDevice[]> {
  return request('/push/subscriptions', pushDevicesSchema).then((body) => body.devices);
}

export function removePushDevice(id: string): Promise<void> {
  return request(
    `/push/subscriptions/${encodeURIComponent(id)}`,
    struct({ removed: Schema.Boolean }),
    { method: 'DELETE' },
  ).then(() => undefined);
}

export function getPushSettings(): Promise<{ showPreviews: boolean }> {
  return request('/push/settings', pushSettingsSchema);
}

export function setPushSettings(showPreviews: boolean): Promise<{ showPreviews: boolean }> {
  return request('/push/settings', pushSettingsSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ showPreviews }),
  });
}

export function sendTestPushNotification(subscriptionId: string): Promise<void> {
  return request('/push/test', struct({ sent: Schema.Boolean }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriptionId }),
  }).then(() => undefined);
}

/** Reorders the caller's whole panel atomically (exact id permutation). */
export async function reorderStickerPanelPacks(order: string[]): Promise<void> {
  await request('/sticker-panel', struct({ ok: Schema.Boolean }), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  });
}

export function patchStickerPack(
  packId: string,
  input: { title?: string; visibility?: 'private' | 'server'; order?: string[] },
): Promise<StickerPack> {
  return request(`/sticker-packs/${encodeURIComponent(packId)}`, stickerPackSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteStickerPack(packId: string): Promise<{ warning: string }> {
  return request(
    `/sticker-packs/${encodeURIComponent(packId)}`,
    struct({ warning: Schema.String }),
    {
      method: 'DELETE',
    },
  );
}

export function deletePackSticker(packId: string, stickerId: string): Promise<{ ok: boolean }> {
  return request(
    `/sticker-packs/${encodeURIComponent(packId)}/stickers/${encodeURIComponent(stickerId)}`,
    struct({ ok: Schema.Boolean }),
    { method: 'DELETE' },
  );
}

/**
 * Uploads one prepared sticker file. Raw bytes (not multipart): the server
 * reads an optional `x-emoji` header, so the client never builds a form.
 * The emoji travels percent-encoded: header values are latin1 ByteStrings,
 * and a raw emoji throws in real `fetch` (`new Headers({'x-emoji':'🐱'})`
 * is a TypeError). The server decodes and validates it.
 */
export async function uploadStickerFile(
  packId: string,
  blob: Blob,
  emoji?: string,
): Promise<Sticker> {
  const headers: Record<string, string> = { 'Content-Type': blob.type };
  if (emoji !== undefined && emoji !== '') {
    headers['x-emoji'] = encodeURIComponent(emoji);
  }
  let response: Response;
  if (isMockApiEnabled()) {
    response = await mockRequest(`/sticker-packs/${encodeURIComponent(packId)}/stickers`, {
      method: 'POST',
      headers,
      body: blob as unknown as string,
    });
  } else {
    try {
      response = await fetch(`${API_BASE}/sticker-packs/${encodeURIComponent(packId)}/stickers`, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: blob,
      });
    } catch {
      throw new ApiError(0, 'network_error', 'Could not reach the server');
    }
  }
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw toApiError(response.status, raw);
  }
  const parsed = decodeResponse(stickerSchema, raw);
  if (!parsed.ok) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server sent an unexpected response',
    );
  }
  return parsed.value;
}

// --- Sticker favorites (T-0121) --------------------------------------------
// One user's starred stickers, at most 200, oldest first.

const stickerFavoritesSchema = struct({
  favorites: Schema.mutable(Schema.Array(stickerSchema)),
});

export function listStickerFavorites(): Promise<Sticker[]> {
  return request('/sticker-favorites', stickerFavoritesSchema).then((body) => body.favorites);
}

export function addStickerFavorite(stickerId: string): Promise<Sticker> {
  return request('/sticker-favorites', stickerSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sticker_id: stickerId }),
  });
}

export async function removeStickerFavorite(stickerId: string): Promise<void> {
  const params = new URLSearchParams({ sticker_id: stickerId });
  await request(`/sticker-favorites?${params.toString()}`, struct({ ok: Schema.Boolean }), {
    method: 'DELETE',
  });
}

// --- Telegram import (T-0123) -------------------------------------------------
// A public Telegram pack's static stickers, imported into a private Zilar
// pack through the server (`TELEGRAM_BOT_TOKEN` lives there; the browser
// never sees it). Animated/video stickers are skipped and counted;
// `partial` means the request budget ran out — running the import again
// fills the gaps. Imported packs are personal-use only (`importedFrom` is
// set, visibility stays private, the UI says so).

export const telegramImportResultSchema = struct({
  pack: stickerPackSchema,
  imported: Schema.Number,
  skippedAnimated: Schema.Number,
  skippedInvalid: Schema.Number,
  partial: Schema.optional(Schema.Boolean),
});

export type TelegramImportResult = typeof telegramImportResultSchema.Type;

export function importTelegramStickers(input: string): Promise<TelegramImportResult> {
  return request('/sticker-packs/import/telegram', telegramImportResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
}

// --- Integrations settings (T-0162 + Email follow-up) ----------------------
// The server owner's key shelf: the Telegram bot token (sticker import)
// and the sign-in mail sender + Resend key. The token and the key are
// never returned by the server, not even masked — only `configured` and
// `source` say whether one is set.

const integrationsTelegramSchema = struct({
  configured: Schema.Boolean,
  source: Schema.NullOr(Schema.Literals(['env', 'stored'])),
});

const integrationsEmailSchema = struct({
  configured: Schema.Boolean,
  source: Schema.NullOr(Schema.Literals(['env', 'stored'])),
  from: Schema.NullOr(Schema.String),
});

const integrationsStatusSchema = struct({
  telegram: integrationsTelegramSchema,
  email: integrationsEmailSchema,
  voiceTranscription: Schema.optional(
    struct({
      configured: Schema.Boolean,
      baseUrl: Schema.NullOr(Schema.String),
      model: Schema.NullOr(Schema.String),
    }),
  ),
  canManage: Schema.Boolean,
});

export type IntegrationsStatus = typeof integrationsStatusSchema.Type;

export function getIntegrationsStatus(): Promise<IntegrationsStatus> {
  return request('/settings/integrations', integrationsStatusSchema);
}

export async function saveTelegramBotToken(botToken: string): Promise<void> {
  await request('/settings/integrations/telegram', struct({ ok: Schema.Boolean }), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botToken }),
  });
}

export async function removeTelegramBotToken(): Promise<void> {
  await request('/settings/integrations/telegram', struct({ ok: Schema.Boolean }), {
    method: 'DELETE',
  });
}

export interface SaveEmailSettingsInput {
  from: string;
  resendApiKey?: string | undefined;
}

export async function saveEmailSettings(input: SaveEmailSettingsInput): Promise<void> {
  const body =
    input.resendApiKey === undefined
      ? { from: input.from }
      : { from: input.from, resendApiKey: input.resendApiKey };
  await request('/settings/integrations/email', struct({ ok: Schema.Boolean }), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// --- Voice transcripts (T-0170) --------------------------------------------
// Transcription is off by default and configured by the server owner (an
// OpenAI-compatible endpoint); the web shows "Show transcript" on voice
// messages only while the server says it is enabled. The per-session cache
// in `VoiceMessage` keeps a tap from refetching; the server caches per URL.
export interface SaveVoiceTranscriptionInput {
  baseUrl: string;
  apiKey?: string | undefined;
  model?: string | undefined;
}

export function getVoiceTranscriptionStatus(): Promise<{ enabled: boolean }> {
  return request('/voice/transcription', struct({ enabled: Schema.Boolean }));
}

export function getVoiceTranscript(url: string): Promise<{ text: string }> {
  return request('/voice/transcript', struct({ text: Schema.String }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

export async function saveVoiceTranscriptionSettings(
  input: SaveVoiceTranscriptionInput,
): Promise<void> {
  const body: Record<string, string> = { baseUrl: input.baseUrl };
  if (input.apiKey !== undefined) {
    body['apiKey'] = input.apiKey;
  }
  if (input.model !== undefined) {
    body['model'] = input.model;
  }
  await request('/settings/integrations/voice-transcription', struct({ ok: Schema.Boolean }), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function removeVoiceTranscriptionSettings(): Promise<void> {
  await request('/settings/integrations/voice-transcription', struct({ ok: Schema.Boolean }), {
    method: 'DELETE',
  });
}

// --- GIFs (T-0122) --------------------------------------------------------
// Privacy-preserving search: the browser never contacts the provider. Every
// media URL arrives as an opaque `mediaToken` minted for this user; previews
// and the send path load through the same-origin proxy
// (`/api/gifs/media/:token`). An unconfigured provider answers 501
// `gifs_unavailable` and the panel hides the tab.

export const gifResultSchema = struct({
  id: Schema.String,
  title: Schema.String,
  mediaToken: Schema.String,
  kind: Schema.Literals(['image', 'video']),
  width: Schema.Number,
  height: Schema.Number,
  sizeBytes: Schema.optional(Schema.Number),
});

export type GifResult = typeof gifResultSchema.Type;

const gifPageSchema = struct({
  items: Schema.mutable(Schema.Array(gifResultSchema)),
  nextPos: Schema.optional(Schema.String),
});

export interface GifPage {
  items: GifResult[];
  nextPos?: string | undefined;
}

async function gifRequest(
  params: URLSearchParams,
  endpoint: 'search' | 'trending',
  signal?: AbortSignal,
): Promise<GifPage> {
  let response: Response;
  if (isMockApiEnabled()) {
    response = await mockRequest(`/gifs/${endpoint}?${params.toString()}`, { method: 'GET' });
  } else {
    if (signal?.aborted === true) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      response = await fetch(`${API_BASE}/gifs/${endpoint}?${params.toString()}`, {
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
    throw toApiError(response.status, raw);
  }
  const parsed = decodeResponse(gifPageSchema, raw);
  if (!parsed.ok) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server sent an unexpected response',
    );
  }
  return parsed.value;
}

export function searchGifs(query: string, pos?: string, signal?: AbortSignal): Promise<GifPage> {
  const params = new URLSearchParams();
  params.set('q', query);
  if (pos !== undefined && pos !== '') {
    params.set('pos', pos);
  }
  return gifRequest(params, 'search', signal);
}

export function trendingGifs(pos?: string, signal?: AbortSignal): Promise<GifPage> {
  const params = new URLSearchParams();
  if (pos !== undefined && pos !== '') {
    params.set('pos', pos);
  }
  return gifRequest(params, 'trending', signal);
}

/** The same-origin proxy URL for one GIF result's media. */
export function gifMediaUrl(mediaToken: string): string {
  return `${API_BASE}/gifs/media/${encodeURIComponent(mediaToken)}`;
}

// --- Audit log (T-0079, T-0084) --------------------------------------------
// The wire contract lives in apps/server/src/audit/routes.ts and service.ts.

const auditCostSchema = Schema.NullOr(
  struct({
    currency: Schema.Literals(['EUR', 'USD']),
    amount: Schema.Number,
  }),
);

export const publicAuditEntrySchema = struct({
  id: Schema.String,
  at: Schema.String,
  aiId: Schema.NullOr(Schema.String),
  groupId: Schema.NullOr(Schema.String),
  action: Schema.String,
  subjectId: Schema.NullOr(Schema.String),
  argsHash: Schema.NullOr(Schema.String),
  cost: auditCostSchema,
  result: Schema.Literals(['ok', 'denied', 'error']),
  detail: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  actorUserId: Schema.NullOr(Schema.String),
});

export type PublicAuditEntry = typeof publicAuditEntrySchema.Type;

const auditPageSchema = struct({
  entries: Schema.mutable(Schema.Array(publicAuditEntrySchema)),
  next: Schema.NullOr(Schema.String),
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

// --- First-run setup (T-0161) ------------------------------------------------
// A fresh server has no users: whoever opens it first finishes the setup
// screen (Resend key + admin email) and becomes the first admin by
// completing the emailed sign-in code. The invite code stays in memory in
// the setup page (never in storage, URL or logs) and rides the sign-up
// request itself.

const setupStatusSchema = struct({
  needsSetup: Schema.Boolean,
  mailConfigured: Schema.Boolean,
});

export type SetupStatus = typeof setupStatusSchema.Type;

export function getSetupStatus(): Promise<SetupStatus> {
  return request('/setup/status', setupStatusSchema);
}

const setupResultSchema = struct({
  ok: Schema.Boolean,
  inviteCode: Schema.String,
});

export type SetupResult = typeof setupResultSchema.Type;

export interface SetupInput {
  resendApiKey: string;
  from: string;
  adminEmail: string;
}

export function postSetup(input: SetupInput): Promise<SetupResult> {
  return request('/setup', setupResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

// --- @usernames and contact requests (T-0163) --------------------------------
// Every person has a unique `@username`. Adding someone by handle sends a
// contact request the other person must accept. Handles are stored with the
// typed casing but compared case-insensitively; there is no prefix search.

export type HandleCheckReason = 'invalid' | 'reserved' | 'taken';

const handleCheckSchema = struct({
  available: Schema.Boolean,
  reason: Schema.optional(Schema.Literals(['invalid', 'reserved', 'taken'])),
});

export interface HandleCheck {
  available: boolean;
  reason?: HandleCheckReason | undefined;
}

export function checkHandle(handle: string): Promise<HandleCheck> {
  const params = new URLSearchParams();
  params.set('handle', handle);
  return request(`/handles/check?${params.toString()}`, handleCheckSchema);
}

const claimedHandleSchema = struct({ handle: Schema.String });

export function claimHandle(handle: string): Promise<{ handle: string }> {
  return request('/me/handle', claimedHandleSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle }),
  });
}

export type ContactRelation =
  'none' | 'contact' | 'request_sent' | 'request_received' | 'self' | 'blocked';

const handleProfileSchema = struct({
  userId: Schema.String,
  name: Schema.String,
  handle: Schema.String,
  image: Schema.NullOr(Schema.String),
  relation: Schema.Literals([
    'none',
    'contact',
    'request_sent',
    'request_received',
    'self',
    'blocked',
  ]),
});

export type HandleProfile = typeof handleProfileSchema.Type;

export function lookupByHandle(handle: string): Promise<HandleProfile> {
  return request(`/users/by-handle/${encodeURIComponent(handle)}`, handleProfileSchema);
}

export type ContactRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export const contactRequestPersonSchema = struct({
  userId: Schema.String,
  name: Schema.String,
  handle: Schema.NullOr(Schema.String),
  image: Schema.NullOr(Schema.String),
});

export type ContactRequestPerson = typeof contactRequestPersonSchema.Type;

export const contactRequestViewSchema = struct({
  id: Schema.String,
  status: Schema.Literals(['pending', 'accepted', 'declined', 'cancelled']),
  createdAt: Schema.String,
  other: contactRequestPersonSchema,
});

export type ContactRequestView = typeof contactRequestViewSchema.Type;

const contactRequestListSchema = struct({
  incoming: Schema.mutable(Schema.Array(contactRequestViewSchema)),
  outgoing: Schema.mutable(Schema.Array(contactRequestViewSchema)),
});

export interface ContactRequestList {
  incoming: ContactRequestView[];
  outgoing: ContactRequestView[];
}

const contactRequestRowSchema = struct({
  id: Schema.String,
  fromUserId: Schema.String,
  toUserId: Schema.String,
  status: Schema.Literals(['pending', 'accepted', 'declined', 'cancelled']),
  createdAt: Schema.String,
  decidedAt: Schema.optional(Schema.String),
});

export type ContactRequestRow = typeof contactRequestRowSchema.Type;

const createdRequestSchema = struct({
  request: contactRequestRowSchema,
  // Present when the other side already asked: the web offers "Accept" on
  // the existing request instead of creating a second row.
  incoming: Schema.optional(Schema.Boolean),
});

export function sendContactRequest(handle: string): Promise<{
  request: ContactRequestRow;
  incoming?: boolean | undefined;
}> {
  return request('/contact-requests', createdRequestSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle }),
  });
}

export function listContactRequests(): Promise<ContactRequestList> {
  return request('/contact-requests', contactRequestListSchema);
}

const decidedRequestSchema = struct({ request: contactRequestRowSchema });

export function acceptContactRequest(id: string): Promise<{ request: ContactRequestRow }> {
  return request(`/contact-requests/${encodeURIComponent(id)}/accept`, decidedRequestSchema, {
    method: 'POST',
  });
}

export function declineContactRequest(id: string): Promise<{ request: ContactRequestRow }> {
  return request(`/contact-requests/${encodeURIComponent(id)}/decline`, decidedRequestSchema, {
    method: 'POST',
  });
}

export function cancelContactRequest(id: string): Promise<{ request: ContactRequestRow }> {
  return request(`/contact-requests/${encodeURIComponent(id)}`, decidedRequestSchema, {
    method: 'DELETE',
  });
}

// --- Blocked people (T-0235) -------------------------------------------------
// Silent blocking: the blocked person is not told, and their contact
// requests never reach the blocker. Writes answer `{ blocked: true/false }`,
// the list answers newest first.

const blockResultSchema = struct({ blocked: Schema.Boolean });

const blockedPersonSchema = struct({
  userId: Schema.String,
  name: Schema.String,
  handle: Schema.NullOr(Schema.String),
  image: Schema.NullOr(Schema.String),
  jid: Schema.NullOr(Schema.String),
});

export type BlockedPerson = typeof blockedPersonSchema.Type;

const blockedListSchema = struct({ blocked: Schema.mutable(Schema.Array(blockedPersonSchema)) });

export function blockUser(userId: string): Promise<{ blocked: boolean }> {
  return request(`/blocks/${encodeURIComponent(userId)}`, blockResultSchema, {
    method: 'PUT',
  });
}

export function unblockUser(userId: string): Promise<{ blocked: boolean }> {
  return request(`/blocks/${encodeURIComponent(userId)}`, blockResultSchema, {
    method: 'DELETE',
  });
}

export async function listBlockedUsers(): Promise<BlockedPerson[]> {
  const { blocked } = await request('/blocks', blockedListSchema);
  return blocked;
}

// --- Public groups and channels (T-0164) -----------------------------------
// A public group or channel holds its own `@handle` (the same namespace as
// `@username`s), appears in the directory, and joins with one tap. A
// private group stays invisible and invite-only, exactly as before.

export const directoryEntrySchema = struct({
  id: Schema.String,
  kind: Schema.Literals(['group', 'channel']),
  title: Schema.String,
  handle: Schema.String,
  description: Schema.NullOr(Schema.String),
  memberCount: Schema.Number,
  joined: Schema.Boolean,
  // T-0165: the group's picture, when it has one. Optional so older
  // payloads parse (treated as none).
  avatarUrl: Schema.optional(Schema.String),
});

export type DirectoryEntry = typeof directoryEntrySchema.Type;

const directoryPageSchema = struct({
  entries: Schema.mutable(Schema.Array(directoryEntrySchema)),
  next: Schema.NullOr(Schema.String),
});

export interface DirectoryPage {
  entries: DirectoryEntry[];
  next: string | null;
}

export interface SearchDirectoryInput {
  q?: string;
  kind?: 'group' | 'channel';
  cursor?: string;
}

export function searchDirectory(input: SearchDirectoryInput = {}): Promise<DirectoryPage> {
  const params = new URLSearchParams();
  if (input.q !== undefined && input.q !== '') {
    params.set('q', input.q);
  }
  if (input.kind !== undefined) {
    params.set('kind', input.kind);
  }
  if (input.cursor !== undefined && input.cursor !== '') {
    params.set('cursor', input.cursor);
  }
  const suffix = params.size === 0 ? '' : `?${params.toString()}`;
  return request(`/directory${suffix}`, directoryPageSchema);
}

// Exact match of one public group by `@handle` (case-insensitive). A
// private group and an unknown handle answer the same 404.
export function lookupGroupByHandle(handle: string): Promise<DirectoryEntry> {
  return request(`/groups/by-handle/${encodeURIComponent(handle)}`, directoryEntrySchema);
}

const publicJoinResultSchema = struct({
  groupId: Schema.String,
  alreadyMember: Schema.Boolean,
});

export type PublicJoinResult = typeof publicJoinResultSchema.Type;

// Joins a public group or channel with one request (private or unknown
// answers the same 404; a full group 409 `group_full`; joining twice is
// harmless with `alreadyMember: true`).
export function joinPublicGroup(groupId: string): Promise<PublicJoinResult> {
  return request(`/groups/${encodeURIComponent(groupId)}/join`, publicJoinResultSchema, {
    method: 'POST',
  });
}

// Owner-only: flips a group public (with a handle) or back to private.
// Unique violations map to 409 `handle_taken`; the 14-day interval to 409
// `handle_change_too_soon` with `nextChangeAt` in the error detail.
export function setGroupVisibility(
  groupId: string,
  input: { visibility: 'private' | 'public'; handle?: string },
): Promise<GroupDetail> {
  return request(`/groups/${encodeURIComponent(groupId)}`, groupDetailSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

// Live availability of a handle for a public group or channel (the same
// shape, reserved words and uniqueness as `@username`s; the asker's own
// group reservation counts as available).
export function checkGroupHandle(handle: string): Promise<HandleCheck> {
  const params = new URLSearchParams();
  params.set('handle', handle);
  params.set('kind', 'group');
  return request(`/handles/check?${params.toString()}`, handleCheckSchema);
}

// --- Avatars (T-0165) ------------------------------------------------------
// Profile pictures for people, AIs, groups and channels. The browser crops
// and resizes (see `AvatarUploader`); the client uploads the raw bytes and
// the server validates by magic bytes (static WebP/PNG only, square,
// 64–512 px, ≤ 256 KB). The response carries the new `url`
// (`/api/avatars/<id>`), which every list route also serves as `avatarUrl`.
const avatarUrlSchema = struct({ url: Schema.String });

export function uploadAvatar(
  kind: 'user' | 'ai' | 'group',
  ownerId: string,
  blob: Blob,
): Promise<{ url: string }> {
  return uploadAvatarBytes(`/avatars/${kind}/${encodeURIComponent(ownerId)}`, blob);
}

async function uploadAvatarBytes(path: string, blob: Blob): Promise<{ url: string }> {
  let response: Response;
  if (isMockApiEnabled()) {
    response = await mockRequest(path, {
      method: 'PUT',
      headers: { 'Content-Type': blob.type },
      body: blob as unknown as string,
    });
  } else {
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': blob.type },
        body: blob,
      });
    } catch {
      throw new ApiError(0, 'network_error', 'Could not reach the server');
    }
  }
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw toApiError(response.status, raw);
  }
  const parsed = decodeResponse(avatarUrlSchema, raw);
  if (!parsed.ok) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server sent an unexpected response',
    );
  }
  return parsed.value;
}

export async function removeAvatar(kind: 'user' | 'ai' | 'group', ownerId: string): Promise<void> {
  await request(`/avatars/${kind}/${encodeURIComponent(ownerId)}`, struct({ ok: Schema.Boolean }), {
    method: 'DELETE',
  });
}

// --- Chat background images (T-0464) ---------------------------------------
// Personal wallpapers for the chat background dialog. The client resizes and
// re-encodes before upload (`lib/background-image.ts`); the server validates
// by magic bytes (WebP/PNG, 64-2048 px, at most 1 MiB, at most 20 per user).
const backgroundImageSchema = struct({
  id: Schema.String,
  url: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
});

export type BackgroundImage = typeof backgroundImageSchema.Type;

const backgroundListItemSchema = struct({
  id: Schema.String,
  url: Schema.String,
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
  createdAt: Schema.String,
});

export type BackgroundListItem = typeof backgroundListItemSchema.Type;

const backgroundListSchema = struct({
  backgrounds: Schema.mutable(Schema.Array(backgroundListItemSchema)),
});

// The POST twin of `uploadAvatarBytes`: a raw-body fetch with a mock branch,
// `toApiError` on failure and an Effect Schema parse of the reply.
export async function uploadBackground(blob: Blob): Promise<BackgroundImage> {
  let response: Response;
  if (isMockApiEnabled()) {
    response = await mockRequest('/backgrounds', {
      method: 'POST',
      headers: { 'Content-Type': blob.type },
      body: blob as unknown as string,
    });
  } else {
    try {
      response = await fetch(`${API_BASE}/backgrounds`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': blob.type },
        body: blob,
      });
    } catch {
      throw new ApiError(0, 'network_error', 'Could not reach the server');
    }
  }
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw toApiError(response.status, raw);
  }
  const parsed = decodeResponse(backgroundImageSchema, raw);
  if (!parsed.ok) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server sent an unexpected response',
    );
  }
  return parsed.value;
}

export function listBackgrounds(): Promise<BackgroundListItem[]> {
  return request('/backgrounds', backgroundListSchema).then((body) => body.backgrounds);
}

export async function deleteBackground(id: string): Promise<void> {
  await request(`/backgrounds/${encodeURIComponent(id)}`, Schema.Null, { method: 'DELETE' });
}
