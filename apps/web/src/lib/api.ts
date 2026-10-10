import { Exit, Schema } from 'effect';
import { ApiError, apiErrorFromBody, type Pin, type PinKind } from '@zilar/api-contract';
import {
  HANDLE_CHECK_MAX,
  HANDLE_CHECK_MIN,
  type BlockedPerson,
  type Contact,
  type ContactRequestPerson,
  type ContactRequestRow,
  type ContactRequestStatus,
  type ContactRequestView,
  type DirectoryEntry,
  type HandleCheck,
  type HandleCheckReason,
  type HandleProfile,
  type SearchItem,
  omitUndefined,
  type BackgroundPreset,
  type ChatBackgroundChoice,
  type ChatFolder as ApiChatFolder,
  type CreatedInviteLink,
  type GroupAi,
  type GroupDetail,
  type GroupJoinResult,
  type GroupMember,
  type GroupRole,
  type ListenerEagerness,
  type InviteLink as GroupInviteLink,
  type JoinPreview,
  type JoinResult,
  type ChatPref,
  type ApproverRole,
  type Topic,
  type TopicAi,
  type TopicKind,
  type TopicMember,
  type TopicOwner,
  type TopicRole,
  type TopicStatus,
  type TopicVisibility,
  Topic as topicSchema,
  trimTopicText,
} from '@zilar/api-contract';
import type { FolderChatType, FolderIcon } from '@zilar/chat-core';
import { struct } from '@zilar/protocol';
import { callApi, callApiAbortable } from '@/lib/effect/api-client';
import { isMockApiEnabled } from '@/mock/gate';
import { loadMockRequest } from '@/mock/load';
import { ApprovalRule, PublicApproval, isProviderId } from '@zilar/api-contract';
import type {
  AiLimits,
  AiMemoryFact,
  AiTemplate,
  AiUsage,
  ApprovalDecision,
  ApprovalStatus,
  ConnectionView,
  PublicAi as ContractAi,
  PublicAuditEntry,
  ToolListItem,
} from '@zilar/api-contract';

/** Base path for the server API. The Vite dev server proxies it same-origin. */
export const API_BASE = '/api';

// One error class for every call, hand-written or derived from the contract.
export { ApiError };

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

// The profile and invite schemas live in `@zilar/api-contract` (`auth.ts`,
// T-0895); their later fields (`handle`, `avatarUrl`, `jid`) are optional so
// payloads from an older server still parse.
export type Me = AuthMe;

export type { Contact };

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

// The group detail schemas live in `@zilar/api-contract` (T-0892). The fields
// older servers omitted stay optional there, so older payloads still parse.
export type { GroupAi, GroupDetail, GroupMember, ListenerEagerness };

export type Invite = AuthInvite;

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
    response = await (await loadMockRequest())(path, init);
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
    throw apiErrorFromBody(response.status, raw);
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

export function getMe(): Promise<Me> {
  return callApi((client) => client.auth.me());
}

// The contract encodes the trimmed name (the server trimmed it anyway).
export function updateMe(name: string): Promise<Me> {
  return callApi((client) => client.auth.patchMe({ payload: { name: name.trim() } }));
}

export async function getChats(): Promise<ChatEntry[]> {
  // The contract passes the entries through as `unknown`; they are validated
  // here, and one malformed entry fails the whole list.
  const body = await callApi((client) => client.chats.list());
  const parsed = decodeResponse(chatsSchema, body);
  if (!parsed.ok) {
    throw new ApiError(200, 'invalid_response', 'The server sent an unexpected response');
  }
  return parsed.value.chats;
}

export async function getContacts(): Promise<Contact[]> {
  return callApi((client) => client.contacts.list()).then((rows) => [...rows]);
}

export function createGroup(input: {
  title: string;
  memberIds: string[];
  // T-0124: `channel` creates the broadcast feed (moderated room).
  kind?: 'group' | 'channel';
  // T-0124: the channel's short blurb (≤ 300).
  description?: string;
}): Promise<GroupDetail> {
  // The server trims `title` and `description`; the contract encodes the
  // trimmed form, so the client trims before sending.
  return callApi((client) =>
    client.groups.create({
      payload: {
        ...omitUndefined(input),
        title: input.title.trim(),
        ...(input.description === undefined ? {} : { description: input.description.trim() }),
      },
    }),
  );
}

export function getGroup(groupId: string): Promise<GroupDetail> {
  return callApi((client) => client.groups.detail({ params: { id: groupId } }));
}

// T-0054: an owner or admin adds their own AI to a group, and its owner or a
// group manager removes it. Both answer the fresh group detail.
export function addGroupAi(groupId: string, aiId: string): Promise<GroupDetail> {
  return callApi((client) => client.groups.addAi({ params: { id: groupId }, payload: { aiId } }));
}

export function removeGroupAi(groupId: string, aiId: string): Promise<GroupDetail> {
  return callApi((client) => client.groups.removeAi({ params: { id: groupId, aiId } }));
}

export function createInvite(): Promise<Invite> {
  return callApi((client) => client.auth.createInvite());
}

export function getInvite(code: string): Promise<{ valid: boolean }> {
  return callApi((client) => client.authInvitesPublic.checkInvite({ params: { code } }));
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
// The schemas live in `@zilar/api-contract` (T-0892). T-0116: `roles` and
// `approverRole` are absent on older servers (treated as none). An unknown
// kind, status or visibility from a newer server reads as `chat`, `open` and
// `private`. `topicSchema` stays exported for the chat entries, which carry
// topic rows that are decoded one by one.
export { topicSchema };
export type {
  ApproverRole,
  Topic,
  TopicAi,
  TopicKind,
  TopicMember,
  TopicOwner,
  TopicRole,
  TopicStatus,
  TopicVisibility,
};

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
  return callApi((client) => client.topics.list({ params: { id: groupId } })).then(
    ({ topics }) => topics,
  );
}

export function createTopic(groupId: string, input: CreateTopicInput): Promise<Topic> {
  return callApi((client) =>
    client.topics.create({
      params: { id: groupId },
      payload: omitUndefined(trimTopicText(input)),
    }),
  );
}

export function getTopic(id: string): Promise<Topic> {
  return callApi((client) => client.topics.detail({ params: { id } }));
}

export function patchTopic(id: string, input: PatchTopicInput): Promise<Topic> {
  return callApi((client) =>
    client.topics.patch({ params: { id }, payload: omitUndefined(trimTopicText(input)) }),
  );
}

export function archiveTopic(id: string): Promise<Topic> {
  return callApi((client) => client.topics.archive({ params: { id } }));
}

export function listTopicMembers(id: string): Promise<TopicMember[]> {
  return callApi((client) => client.topics.members({ params: { id } })).then(
    ({ members }) => members,
  );
}

export function addTopicMember(id: string, userId: string): Promise<Topic> {
  return callApi((client) => client.topics.addMember({ params: { id }, payload: { userId } }));
}

export function removeTopicMember(id: string, userId: string): Promise<Topic> {
  return callApi((client) => client.topics.removeMember({ params: { id, userId } }));
}

export function listTopicAis(id: string): Promise<TopicAi[]> {
  return callApi((client) => client.topics.listAis({ params: { id } })).then(({ ais }) => ais);
}

export function addTopicAi(id: string, aiId: string): Promise<Topic> {
  return callApi((client) => client.topics.addAi({ params: { id }, payload: { aiId } }));
}

export function removeTopicAi(id: string, aiId: string): Promise<Topic> {
  return callApi((client) => client.topics.removeAi({ params: { id, aiId } }));
}

// --- Group roles (T-0116) ---------------------------------------------------
// Custom group roles: labels with two powers (private-topic access and
// approver rights). Reading needs only membership; every write needs a
// group owner/admin.

// The schemas live in `@zilar/api-contract` (T-0892).
export type { GroupRole };

export function listGroupRoles(groupId: string): Promise<GroupRole[]> {
  return callApi((client) => client.roles.list({ params: { id: groupId } })).then(
    ({ roles }) => roles,
  );
}

// The server trims `name`; the contract encodes the trimmed form, so the
// client trims before sending.
export function createGroupRole(groupId: string, name: string): Promise<GroupRole> {
  return callApi((client) =>
    client.roles.create({ params: { id: groupId }, payload: { name: name.trim() } }),
  );
}

export function renameGroupRole(groupId: string, roleId: string, name: string): Promise<GroupRole> {
  return callApi((client) =>
    client.roles.rename({ params: { id: groupId, roleId }, payload: { name: name.trim() } }),
  );
}

export async function deleteGroupRole(groupId: string, roleId: string): Promise<void> {
  await callApi((client) => client.roles.remove({ params: { id: groupId, roleId } }));
}

export function setGroupRoleMembers(
  groupId: string,
  roleId: string,
  userIds: string[],
): Promise<GroupRole> {
  return callApi((client) =>
    client.roles.setMembers({ params: { id: groupId, roleId }, payload: { userIds } }),
  );
}

export interface SetTopicRolesInput {
  roleIds: string[];
  approverRoleId: string | null;
}

export function setTopicRoles(id: string, input: SetTopicRolesInput): Promise<Topic> {
  return callApi((client) => client.topics.setRoles({ params: { id }, payload: input }));
}

// T-0108: the group owner/admin switch for plain members creating topics.
export function setMembersCanCreateTopics(
  groupId: string,
  membersCanCreateTopics: boolean,
): Promise<GroupDetail> {
  return callApi((client) =>
    client.groups.patch({ params: { id: groupId }, payload: { membersCanCreateTopics } }),
  );
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
  return callApi((client) =>
    client.groups.patch({ params: { id: groupId }, payload: omitUndefined(input) }),
  );
}

// The patch encoder checks the preset against the contract's list, so an
// unknown id fails as `invalid_request` before any request is sent.
function backgroundPatch(background: GroupBackground) {
  return {
    ...background,
    backgroundPreset: background.backgroundPreset as BackgroundPreset | null,
  };
}

// T-0466: owners and admins set the group's shared background. A member gets
// 403; `null` fields clear them.
export function setGroupBackground(
  groupId: string,
  background: GroupBackground,
): Promise<GroupDetail> {
  return callApi((client) =>
    client.groups.patch({
      params: { id: groupId },
      payload: { background: backgroundPatch(background) },
    }),
  );
}

// Web UI helper for T-0111: the panel shows the rules of one topic, read
// through the existing per-group list (each row carries its `topicId`).
// Declared as a type alias (not a const) because the approval schemas are
// defined further below in this file.

// --- Channels (T-0124) -------------------------------------------------------
// One-way broadcast feeds: only owner/admins post (the room is moderated and
// subscribers are visitors), everyone else subscribes, reads and mutes. A
// channel is a group with one feed (its General topic): no more topics, and
// the member list is visible to admins only (subscribers see the count).
export function listGroupMembers(groupId: string): Promise<GroupMember[]> {
  return callApi((client) => client.groups.members({ params: { id: groupId } })).then(
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
  return callApi((client) =>
    client.groups.changeRole({ params: { id: groupId, userId }, payload: { role } }),
  );
}

export function removeGroupMember(groupId: string, userId: string): Promise<GroupDetail> {
  return callApi((client) => client.groups.removeMember({ params: { id: groupId, userId } }));
}

export type TopicTool = ToolListItem;

export async function listTopicTools(topicId: string): Promise<TopicTool[]> {
  const rows = await callApi((client) => client.tools.listForTopic({ params: { id: topicId } }));
  return [...rows];
}

// --- Group invite links (T-0115) -------------------------------------------
// Shareable links that join a group as `member` (`${WEB}/j/<token>` on the
// web). The token is shown once at creation and never stored — the list
// below carries hints, labels, uses and state, never tokens.
// The schemas live in `@zilar/api-contract` (T-0892).
export type { CreatedInviteLink, GroupInviteLink };

export interface CreateGroupInviteLinkInput {
  label?: string;
  expiresInHours?: number;
  maxUses?: number;
}

// The server trims `label`; the contract encodes the trimmed form, so the
// client trims before sending.
export function createGroupInviteLink(
  groupId: string,
  input: CreateGroupInviteLinkInput = {},
): Promise<CreatedInviteLink> {
  return callApi((client) =>
    client['invite-links'].createLink({
      params: { id: groupId },
      payload: {
        ...omitUndefined(input),
        ...(input.label === undefined ? {} : { label: input.label.trim() }),
      },
    }),
  );
}

export function listGroupInviteLinks(groupId: string): Promise<GroupInviteLink[]> {
  return callApi((client) => client['invite-links'].listLinks({ params: { id: groupId } })).then(
    ({ links }) => links,
  );
}

export async function revokeGroupInviteLink(groupId: string, linkId: string): Promise<void> {
  await callApi((client) => client['invite-links'].revokeLink({ params: { id: groupId, linkId } }));
}

// --- Join by link (T-0115) -------------------------------------------------
// The preview names the group and counts its members — never member names,
// and never the group id unless the caller is already a member (they know
// it; the join page opens the group chat with it). Joining adds the caller
// as `member` and returns the group id; an existing member answers
// `alreadyMember: true` without consuming a use.

// T-0124: `channel` previews read "Join channel" (and count subscribers);
// `kind` is absent on older servers = a group.
export type { JoinPreview, JoinResult };

export function previewJoinLink(token: string): Promise<JoinPreview> {
  return callApi((client) => client['invite-links'].preview({ params: { token } }));
}

export function joinByLink(token: string): Promise<JoinResult> {
  return callApi((client) => client['invite-links'].join({ params: { token } }));
}

// --- Chat preferences (T-0113) -------------------------------------------------
// Per-user mute/archive/pin rows, synced across devices. The wire contract
// lives in apps/server/src/chat-prefs/api.ts and service.ts. Muting a
// group covers its topics (the pref sits on the General room JID and the
// client applies it to every topic unless the topic has its own row).

// The schemas live in `@zilar/api-contract` (T-0892). T-0461: the per-chat
// background fields are all null when the chat inherits the caller's global
// default.
export type { ChatPref };

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
  return callApi((client) => client.chatPrefs.list()).then((body) => [...body.prefs]);
}

// T-0461: the caller's global chat background default (T-0458). `GET
// /chat-background` returns it under `defaultBackground`; all-null means the
// caller never chose one, so chats fall back to the slate grid.
export type { ChatBackgroundChoice };

export function getChatBackgroundDefault(): Promise<ChatBackgroundChoice> {
  return callApi((client) => client.chatPrefs.getBackground()).then(
    (body) => body.defaultBackground,
  );
}

// The payload encoder checks the preset against the contract's list, so an
// unknown id fails as `invalid_request` before any request is sent. Fields set
// to `undefined` are left out, as `JSON.stringify` always did.
function prefPayload(input: PutChatPrefInput) {
  return omitUndefined({
    ...input,
    backgroundPreset: input.backgroundPreset as BackgroundPreset | null | undefined,
  });
}

// T-0462: write the caller's global background default. The body carries the
// same three fields as the per-chat patch and the reply is the saved default.
export function putChatBackgroundDefault(
  input: ChatBackgroundChoice,
): Promise<ChatBackgroundChoice> {
  return callApi((client) => client.chatPrefs.putBackground({ payload: prefPayload(input) })).then(
    (body) => body.defaultBackground,
  );
}

export async function putChatPref(
  chatJid: string,
  input: PutChatPrefInput,
): Promise<ChatPref | null> {
  const saved = await callApi((client) =>
    client.chatPrefs.putPref({
      params: { chatJid },
      payload: prefPayload(input),
    }),
  );
  return 'prefs' in saved ? null : saved;
}

// --- Chat folders (T-0237) ---------------------------------------------------
// Folders come from the server (`apps/server/src/chat-folders/api.ts`);
// the client only lists and syncs them here (create/rename/delete/reorder
// UI is T-0238). The wire shape mirrors `ChatFolder` in chat-core.

// The schemas live in `@zilar/api-contract` (T-0892).
export type { ApiChatFolder };

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
  return callApi((client) => client.chatFolders.list()).then((body) => [...body.folders]);
}

// The server trims `name`; the contract encodes the trimmed form, so the
// client trims before sending.
export function createChatFolder(input: CreateChatFolderInput): Promise<ApiChatFolder> {
  return callApi((client) =>
    client.chatFolders.create({ payload: { ...omitUndefined(input), name: input.name.trim() } }),
  ).then((body) => body.folder);
}

// The server trims `name`; the contract encodes the trimmed form, so the
// client trims before sending.
export function patchChatFolder(id: string, input: PatchChatFolderInput): Promise<ApiChatFolder> {
  return callApi((client) =>
    client.chatFolders.update({
      params: { id },
      payload: {
        ...omitUndefined(input),
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
      },
    }),
  ).then((body) => body.folder);
}

export function reorderChatFolders(ids: string[]): Promise<ApiChatFolder[]> {
  return callApi((client) => client.chatFolders.order({ payload: { ids } })).then((body) => [
    ...body.folders,
  ]);
}

export async function deleteChatFolder(id: string): Promise<void> {
  await callApi((client) => client.chatFolders.remove({ params: { id } }));
}

// --- Pinned messages (T-0114) ------------------------------------------------
// The contract (schemas and endpoints) lives in `@zilar/api-contract`
// (`pins.ts`, T-0864); these functions are thin wrappers over the derived
// client. Pins arrive newest first.

export type { Pin, PinKind };

export interface PinMessageInput {
  chat: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: PinKind;
}

export function listPins(chat: string): Promise<Pin[]> {
  return callApi((client) => client.pins.list({ query: { chat } })).then((body) => [...body.pins]);
}

// The server trims `senderName`; the contract encodes the trimmed form, so
// the client trims before sending.
export function pinMessage(input: PinMessageInput): Promise<Pin> {
  return callApi((client) =>
    client.pins.create({ payload: { ...input, senderName: input.senderName.trim() } }),
  );
}

export async function unpinMessage(id: string): Promise<void> {
  await callApi((client) => client.pins.remove({ params: { id } }));
}

// --- AI memory (T-0443) ------------------------------------------------------
// The wire contract lives in apps/server/src/agents/memory/api.ts. `chat`
// is the DM peer's bare JID (the AI's JID in a DM); `aiId` is the AI's id. The
// server answers the pinned facts and the cover lines; `canChange` is false
// for a room member who may only view.

export interface AiMemory {
  facts: AiMemoryFact[];
  lines: string[];
  canChange: boolean;
}

export async function getAiMemory(chat: string, aiId: string): Promise<AiMemory> {
  const memory = await callApi((client) => client.aiMemory.view({ query: { chat, ai: aiId } }));
  return { facts: [...memory.facts], lines: [...memory.lines], canChange: memory.canChange };
}

export async function forgetAiMemoryFact(
  chat: string,
  aiId: string,
  factId: string,
): Promise<void> {
  await callApi((client) =>
    client.aiMemory.deleteFact({ params: { id: factId }, query: { chat, ai: aiId } }),
  );
}

export async function clearAiMemory(chat: string, aiId: string): Promise<void> {
  await callApi((client) => client.aiMemory.clear({ payload: { chat, ai: aiId } }));
}

// --- Media gallery (T-0434) --------------------------------------------------
// The wire contract lives in apps/server/src/media/api.ts. `chat` is a room
// bare JID for groups/topics, or a DM peer's bare JID. `type` maps to a panel
// tab; `before` is the `next` cursor of the previous page (microseconds as a
// string). Items arrive newest first.

// The schemas and the query keys live in `@zilar/api-contract` (`media.ts`,
// T-0895). The server decodes the query by hand, after its archive check and
// limiter, so every key travels as a plain string.
export type { MediaItem, MediaPage, MediaTab };

export interface ListChatMediaInput {
  chat: string;
  type: MediaTab;
  before?: string;
  limit?: number;
}

export function listChatMedia(input: ListChatMediaInput): Promise<MediaPage> {
  return callApi((client) =>
    client.media.gallery({
      query: {
        chat: input.chat,
        type: input.type,
        ...(input.before === undefined ? {} : { before: input.before }),
        ...(input.limit === undefined ? {} : { limit: String(input.limit) }),
      },
    }),
  ).then((page) => ({ items: [...page.items], next: page.next }));
}

// --- AIs (T-0032) --------------------------------------------------------
// The wire contract lives in apps/server/src/ais/api.ts and service.ts.
// `ApiError` already carries the server's `code` and `status`, so callers can
// branch without parsing the message again.

export type { AiLimits, AiTemplate, AiUsage };

// The contract's AI with mutable fields, the shape the mock backend and the
// fixtures build.
export type PublicAi = { -readonly [K in keyof ContractAi]: ContractAi[K] };

export type Connection = ConnectionView;

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

export async function listAis(): Promise<PublicAi[]> {
  const rows = await callApi((client) => client.ais.list());
  return [...rows];
}

export function getAi(id: string): Promise<PublicAi> {
  return callApi((client) => client.ais.detail({ params: { id } }));
}

// The server trims these strings before its length checks; the contract
// encodes the trimmed form, so they are trimmed here.
export function createAi(input: CreateAiInput): Promise<PublicAi> {
  return callApi((client) =>
    client.ais.create({
      payload: {
        name: input.name.trim(),
        template: input.template,
        ...(input.persona === undefined ? {} : { persona: input.persona.trim() }),
        providerConnectionId: input.providerConnectionId.trim(),
        model: input.model.trim(),
        limits: input.limits,
      },
    }),
  );
}

export function updateAi(id: string, input: UpdateAiInput): Promise<PublicAi> {
  return callApi((client) =>
    client.ais.patch({
      params: { id },
      payload: {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.persona === undefined ? {} : { persona: input.persona.trim() }),
        ...(input.limits === undefined ? {} : { limits: input.limits }),
        ...(input.model === undefined ? {} : { model: input.model.trim() }),
        ...(input.providerConnectionId === undefined
          ? {}
          : { providerConnectionId: input.providerConnectionId.trim() }),
        ...(input.canDelegate === undefined ? {} : { canDelegate: input.canDelegate }),
        ...(input.acceptsDelegation === undefined
          ? {}
          : { acceptsDelegation: input.acceptsDelegation }),
      },
    }),
  );
}

export async function deleteAi(id: string): Promise<void> {
  await callApi((client) => client.ais.remove({ params: { id } }));
}

// T-0080: the owner's kill switch. Both return the fresh public AI so the
// panel can re-render against the server truth without a second GET. The
// server answers the same `not_active` 409 when the AI was already in the
// other terminal state, which the panel treats as a refresh cue.
export function stopAi(id: string): Promise<PublicAi> {
  return callApi((client) => client.ais.stop({ params: { id } }));
}

export function resumeAi(id: string): Promise<PublicAi> {
  return callApi((client) => client.ais.resume({ params: { id } }));
}

// T-0091: set or clear the AI's home machine. `null` clears the assignment
// (the AI runs on the platform); a machine id assigns it. The server
// answers the fresh public AI, so the panel re-renders against server
// truth.
export function setAiMachine(aiId: string, machineId: string | null): Promise<PublicAi> {
  return callApi((client) =>
    client.ais.assignMachine({
      params: { id: aiId },
      payload: { machineId: machineId === null ? null : machineId.trim() },
    }),
  );
}

export async function listConnections(): Promise<Connection[]> {
  const rows = await callApi((client) => client.connections.list());
  return [...rows];
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
  const { provider } = input;
  if (!isProviderId(provider)) {
    return Promise.reject(new ApiError(400, 'invalid_request', 'Invalid connection request'));
  }
  // The server trims the key and the label; the contract encodes the trimmed form.
  return callApi((client) =>
    client.connections.create({
      payload: {
        provider,
        key: input.key.trim(),
        ...(input.label === undefined ? {} : { label: input.label.trim() }),
      },
    }),
  );
}

export interface ConnectionTestResult {
  ok: boolean;
  message?: string;
}

export function testConnection(id: string): Promise<ConnectionTestResult> {
  return callApi((client) => client.connections.test({ params: { id } }));
}

export async function deleteConnection(id: string): Promise<void> {
  await callApi((client) => client.connections.remove({ params: { id } }));
}

import {
  BackgroundImage as BackgroundImageSchema,
  Machine,
  Sticker as StickerSchema,
  type AuthInvite,
  type AuthMe,
  type BackgroundImage,
  type BackgroundListItem,
  type GifResult,
  type GifResultPage,
  type IntegrationsStatus,
  type MachineStatus,
  type MediaItem,
  type MediaPage,
  type MediaTab,
  type PairingCode,
  type PushConfig,
  type Sticker,
  type StickerPack as ContractStickerPack,
  type TelegramImportResult as ContractTelegramImportResult,
  type PushDevice,
  type RegisteredDevice,
} from '@zilar/api-contract';

// --- Machines (T-0070) ---------------------------------------------------
// The wire contract lives in apps/server/src/machines/api.ts and
// service.ts. `ApiError` carries the server's `code` and `status`, so callers
// can branch without parsing the message again. `online` is optional so the
// schema works before T-0071 (the runner hub) lands.

// The schemas and endpoints live in `@zilar/api-contract` (`machines.ts`,
// T-0895).
export type { Machine, MachineStatus, PairingCode };
export { Machine as machineSchema };

export function listMachines(): Promise<Machine[]> {
  return callApi((client) => client.machines.list()).then((rows) => [...rows]);
}

export function createPairingCode(): Promise<PairingCode> {
  return callApi((client) => client.machines.createPairingCode());
}

export function approveMachine(id: string): Promise<Machine> {
  return callApi((client) => client.machines.approve({ params: { id } }));
}

export async function denyMachine(id: string): Promise<void> {
  await callApi((client) => client.machines.deny({ params: { id } }));
}

export function revokeMachine(id: string): Promise<Machine> {
  return callApi((client) => client.machines.revoke({ params: { id } }));
}

export function renameMachine(id: string, name: string): Promise<Machine> {
  // The server trims the name; the contract encodes the trimmed form.
  return callApi((client) =>
    client.machines.rename({ params: { id }, payload: { name: name.trim() } }),
  );
}

export async function deleteMachine(id: string): Promise<void> {
  await callApi((client) => client.machines.remove({ params: { id } }));
}

// --- Approvals (T-0076) ---------------------------------------------------
// The wire contract lives in apps/server/src/approvals/api.ts and
// service.ts. Dates arrive as ISO strings; we keep them as strings so the
// types line up with `ApprovalRequest.expires_at` and we don't have to think
// about zod's string-to-Date coercion in tests.

export type { ApprovalDecision, ApprovalStatus, ApprovalRule, PublicApproval };

// Kept under their old names: the shared schemas decode a payload from an
// older server (a missing topic, `alwaysEligible: false`, no `approverNames`).
export const publicApprovalSchema = PublicApproval;

export function getApproval(id: string): Promise<PublicApproval> {
  return callApi((client) => client.approvals.detail({ params: { id } }));
}

// T-0081: the inbox page lists everything pending. The server already filters
// by pending, unexpired, decidable by the caller, newest first, max 100.
export async function listApprovals(): Promise<PublicApproval[]> {
  const rows = await callApi((client) => client.approvals.list());
  return [...rows];
}

export function decideApproval(
  id: string,
  decision: ApprovalDecision,
  note?: string,
): Promise<PublicApproval> {
  return callApi((client) =>
    client.approvals.decide({
      params: { id },
      payload: note === undefined ? { decision } : { decision, note },
    }),
  );
}

// --- Approval rules (T-0100) ------------------------------------------------
// The wire contract lives in apps/server/src/approvals/api.ts and
// rules.ts. Dates arrive as ISO strings, kept as strings like the
// approvals schemas. The two list routes 404 for a viewer who may not
// manage the rules, and so does revoke; all three flow through `ApiError`.

export const approvalRuleSchema = ApprovalRule;

export async function listAiApprovalRules(aiId: string): Promise<ApprovalRule[]> {
  const rows = await callApi((client) => client.approvals.aiRules({ params: { id: aiId } }));
  return [...rows];
}

export async function listGroupApprovalRules(groupId: string): Promise<ApprovalRule[]> {
  const rows = await callApi((client) => client.approvals.groupRules({ params: { id: groupId } }));
  return [...rows];
}

export async function revokeApprovalRule(id: string): Promise<void> {
  await callApi((client) => client.approvals.revokeRule({ params: { id } }));
}

// --- Message search (T-0117) -----------------------------------------------
// The wire contract lives in packages/api-contract/src/search.ts. Snippets
// arrive as plain text plus `marks` ranges; the client highlights with
// spans and never renders HTML.

export type { SearchItem };

export interface SearchMessagesInput {
  q: string;
  chat?: string;
  limit?: number;
  before?: string;
  signal?: AbortSignal;
}

export function searchMessages(
  input: SearchMessagesInput,
): Promise<{ items: SearchItem[]; nextBefore?: string | undefined }> {
  // The cursor travels as a string in the app and decodes to a number in the
  // contract; an empty `chat` or `before` is left out, like before.
  const query = {
    q: input.q,
    ...(input.chat === undefined || input.chat === '' ? {} : { chat: input.chat }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.before === undefined || input.before === '' ? {} : { before: Number(input.before) }),
  };
  return callApiAbortable((client) => client.search.search({ query }), input.signal).then(
    (page) => ({
      items: [...page.items],
      ...(page.nextBefore === undefined ? {} : { nextBefore: page.nextBefore }),
    }),
  );
}

// --- Stickers (T-0120) -----------------------------------------------------
// User-made packs: the panel lists mine in order (with stickers), discover
// lists `server`-visible packs, and files are served same-origin so the
// renderer can auto-load them without leaking the viewer's IP.
// The schemas and endpoints live in `@zilar/api-contract` (`stickers.ts`,
// T-0895). `uploadStickerFile` posts raw image bytes, so it stays outside the
// client and decodes with the contract's reply schema.
export type { Sticker };

// The pack keeps a mutable `stickers` array, the shape its editor takes.
export type StickerPack = Omit<ContractStickerPack, 'stickers'> & { stickers: Sticker[] };

function toStickerPack(pack: ContractStickerPack): StickerPack {
  return { ...pack, stickers: [...pack.stickers] };
}

export function listStickerPacks(): Promise<StickerPack[]> {
  return callApi((client) => client.stickers.listPacks()).then((body) =>
    body.packs.map(toStickerPack),
  );
}

// The contract encodes the trimmed title (the server trimmed it anyway).
export function createStickerPack(input: {
  title: string;
  visibility?: 'private' | 'server';
}): Promise<StickerPack> {
  return callApi((client) =>
    client.stickers.createPack({
      payload: omitUndefined({ ...input, title: input.title.trim() }),
    }),
  ).then(toStickerPack);
}

export function discoverStickerPacks(
  query?: string,
): Promise<{ packs: StickerPack[]; next: string | null }> {
  const q = query?.trim();
  return callApi((client) =>
    client.stickers.discover({ query: q === undefined || q === '' ? {} : { q } }),
  ).then((page) => ({
    packs: page.packs.map(toStickerPack),
    next: page.next,
  }));
}

export async function addStickerPanelPack(packId: string): Promise<void> {
  await callApi((client) => client.stickers.addPanelPack({ params: { packId } }));
}

export async function removeStickerPanelPack(packId: string): Promise<void> {
  await callApi((client) => client.stickers.removePanelPack({ params: { packId } }));
}

// --- Push notifications (T-0119) -------------------------------------------
// The wire contract lives in apps/server/src/push/api.ts. The browser
// registers its Web Push subscription, stores it, then enables the push
// pair over its own XMPP session (ejabberd requires the enable IQ from the
// user's session). The device list carries labels and dates only — never
// the endpoint URL or keys.

// The contract (`@zilar/api-contract`, `push.ts`, T-0895) types the replies and
// the three payloads; the server decodes those bodies by hand (their step order
// and error codes are part of the wire).
export type { PushConfig, PushDevice, RegisteredDevice };

export function getPushConfig(): Promise<PushConfig> {
  return callApi((client) => client.push.config());
}

export interface RegisterPushDeviceInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | undefined;
}

export function registerPushDevice(input: RegisterPushDeviceInput): Promise<RegisteredDevice> {
  return callApi((client) =>
    client.push.subscribe({
      payload: {
        endpoint: input.endpoint,
        keys: input.keys,
        ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
      },
    }),
  );
}

export function listPushDevices(): Promise<PushDevice[]> {
  return callApi((client) => client.push.list()).then((body) => [...body.devices]);
}

export function removePushDevice(id: string): Promise<void> {
  return callApi((client) => client.push.remove({ params: { id } })).then(() => undefined);
}

export function getPushSettings(): Promise<{ showPreviews: boolean }> {
  return callApi((client) => client.push.settings());
}

export function setPushSettings(showPreviews: boolean): Promise<{ showPreviews: boolean }> {
  return callApi((client) => client.push.updateSettings({ payload: { showPreviews } }));
}

export function sendTestPushNotification(subscriptionId: string): Promise<void> {
  return callApi((client) => client.push.test({ payload: { subscriptionId } })).then(
    () => undefined,
  );
}

/** Reorders the caller's whole panel atomically (exact id permutation). */
export async function reorderStickerPanelPacks(order: string[]): Promise<void> {
  await callApi((client) => client.stickers.reorderPanel({ payload: { order } }));
}

export function patchStickerPack(
  packId: string,
  input: { title?: string; visibility?: 'private' | 'server'; order?: string[] },
): Promise<StickerPack> {
  return callApi((client) =>
    client.stickers.patchPack({
      params: { id: packId },
      payload: omitUndefined({
        ...input,
        ...(input.title === undefined ? {} : { title: input.title.trim() }),
      }),
    }),
  ).then(toStickerPack);
}

export function deleteStickerPack(packId: string): Promise<{ warning: string }> {
  return callApi((client) => client.stickers.deletePack({ params: { id: packId } }));
}

export function deletePackSticker(packId: string, stickerId: string): Promise<{ ok: boolean }> {
  return callApi((client) => client.stickers.deleteSticker({ params: { id: packId, stickerId } }));
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
    response = await (
      await loadMockRequest()
    )(`/sticker-packs/${encodeURIComponent(packId)}/stickers`, {
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
    throw apiErrorFromBody(response.status, raw);
  }
  const parsed = decodeResponse(StickerSchema, raw);
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

export function listStickerFavorites(): Promise<Sticker[]> {
  return callApi((client) => client.stickers.listFavorites()).then((body) => [...body.favorites]);
}

export function addStickerFavorite(stickerId: string): Promise<Sticker> {
  return callApi((client) => client.stickers.addFavorite({ payload: { sticker_id: stickerId } }));
}

export async function removeStickerFavorite(stickerId: string): Promise<void> {
  await callApi((client) => client.stickers.removeFavorite({ query: { sticker_id: stickerId } }));
}

// --- Telegram import (T-0123) -------------------------------------------------
// A public Telegram pack's static stickers, imported into a private Zilar
// pack through the server (`TELEGRAM_BOT_TOKEN` lives there; the browser
// never sees it). Animated/video stickers are skipped and counted;
// `partial` means the request budget ran out — running the import again
// fills the gaps. Imported packs are personal-use only (`importedFrom` is
// set, visibility stays private, the UI says so).

export type TelegramImportResult = Omit<ContractTelegramImportResult, 'pack'> & {
  pack: StickerPack;
};

export function importTelegramStickers(input: string): Promise<TelegramImportResult> {
  return callApi((client) => client.stickers.importTelegram({ payload: { input } })).then(
    (result) => ({ ...result, pack: toStickerPack(result.pack) }),
  );
}

// --- Integrations settings (T-0162 + Email follow-up) ----------------------
// The server owner's key shelf: the Telegram bot token (sticker import)
// and the sign-in mail sender + Resend key. The token and the key are
// never returned by the server, not even masked — only `configured` and
// `source` say whether one is set.

// The schemas and endpoints live in `@zilar/api-contract` (`integrations.ts`,
// T-0895); these are thin wrappers over the derived client. The contract
// encodes the trimmed form, so the secrets are trimmed before sending (the
// server trimmed them anyway).
export type { IntegrationsStatus };

export function getIntegrationsStatus(): Promise<IntegrationsStatus> {
  return callApi((client) => client.integrations.status());
}

export async function saveTelegramBotToken(botToken: string): Promise<void> {
  await callApi((client) =>
    client.integrations.setTelegram({ payload: { botToken: botToken.trim() } }),
  );
}

export async function removeTelegramBotToken(): Promise<void> {
  await callApi((client) => client.integrations.removeTelegram());
}

export interface SaveEmailSettingsInput {
  from: string;
  resendApiKey?: string | undefined;
}

export async function saveEmailSettings(input: SaveEmailSettingsInput): Promise<void> {
  const from = input.from.trim();
  await callApi((client) =>
    client.integrations.setEmail({
      payload:
        input.resendApiKey === undefined
          ? { from }
          : { from, resendApiKey: input.resendApiKey.trim() },
    }),
  );
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

// The reply schemas and the query keys live in `@zilar/api-contract`
// (`gifs.ts`, T-0895). The server decodes the query by hand, after its provider
// check and limiter, so every key travels as a plain string. A caller may
// abort a search, so the calls go through `callApiAbortable`.
export type { GifResult };

export interface GifPage {
  items: GifResult[];
  nextPos?: string | undefined;
}

function toGifPage(page: GifResultPage): GifPage {
  const { items, nextPos } = page;
  return { items: [...items], ...(nextPos === undefined ? {} : { nextPos }) };
}

export function searchGifs(query: string, pos?: string, signal?: AbortSignal): Promise<GifPage> {
  return callApiAbortable(
    (client) =>
      client.gifs.search({
        query: { q: query, ...(pos === undefined || pos === '' ? {} : { pos }) },
      }),
    signal,
  ).then(toGifPage);
}

export function trendingGifs(pos?: string, signal?: AbortSignal): Promise<GifPage> {
  return callApiAbortable(
    (client) => client.gifs.trending({ query: pos === undefined || pos === '' ? {} : { pos } }),
    signal,
  ).then(toGifPage);
}

/** The same-origin proxy URL for one GIF result's media. */
export function gifMediaUrl(mediaToken: string): string {
  return `${API_BASE}/gifs/media/${encodeURIComponent(mediaToken)}`;
}

// --- Audit log (T-0079, T-0084) --------------------------------------------
// The wire contract lives in apps/server/src/audit/api.ts and service.ts.

export type { PublicAuditEntry };

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

export async function listAudit(input: ListAuditInput): Promise<ListAuditPage> {
  const page = await callApi((client) =>
    client.audit.list({
      query: {
        ...('aiId' in input && input.aiId !== undefined
          ? { aiId: input.aiId }
          : 'groupId' in input && input.groupId !== undefined
            ? { groupId: input.groupId }
            : {}),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.before === undefined || input.before === '' ? {} : { before: input.before }),
      },
    }),
  );
  return { entries: [...page.entries], next: page.next };
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

export type { HandleCheck, HandleCheckReason };

// The server answers a handle outside 1..64 characters with a success body
// (`invalid`), but the derived client encodes the query before it sends it.
// So the same answer is given here, without the round trip.
function checkHandleKind(handle: string, kind?: 'group'): Promise<HandleCheck> {
  if (handle.length < HANDLE_CHECK_MIN || handle.length > HANDLE_CHECK_MAX) {
    return Promise.resolve({ available: false, reason: 'invalid' });
  }
  return callApi((client) =>
    client.handles.check({ query: kind === undefined ? { handle } : { handle, kind } }),
  );
}

export function checkHandle(handle: string): Promise<HandleCheck> {
  return checkHandleKind(handle);
}

export function claimHandle(handle: string): Promise<{ handle: string }> {
  return callApi((client) => client.handles.claim({ payload: { handle } }));
}

export type ContactRelation =
  'none' | 'contact' | 'request_sent' | 'request_received' | 'self' | 'blocked';

export type {
  ContactRequestPerson,
  ContactRequestRow,
  ContactRequestStatus,
  ContactRequestView,
  HandleProfile,
};

export function lookupByHandle(handle: string): Promise<HandleProfile> {
  return callApi((client) => client.contactRequests.byHandle({ params: { handle } }));
}

export interface ContactRequestList {
  incoming: ContactRequestView[];
  outgoing: ContactRequestView[];
}

export function sendContactRequest(handle: string): Promise<{
  request: ContactRequestRow;
  incoming?: boolean | undefined;
}> {
  return callApi((client) => client.contactRequests.create({ payload: { handle } }));
}

export function listContactRequests(): Promise<ContactRequestList> {
  return callApi((client) => client.contactRequests.list()).then((body) => ({
    incoming: [...body.incoming],
    outgoing: [...body.outgoing],
  }));
}

export function acceptContactRequest(id: string): Promise<{ request: ContactRequestRow }> {
  return callApi((client) => client.contactRequests.accept({ params: { id } }));
}

export function declineContactRequest(id: string): Promise<{ request: ContactRequestRow }> {
  return callApi((client) => client.contactRequests.decline({ params: { id } }));
}

export function cancelContactRequest(id: string): Promise<{ request: ContactRequestRow }> {
  return callApi((client) => client.contactRequests.cancel({ params: { id } }));
}

// --- Blocked people (T-0235) -------------------------------------------------
// Silent blocking: the blocked person is not told, and their contact
// requests never reach the blocker. Writes answer `{ blocked: true/false }`,
// the list answers newest first.

export type { BlockedPerson };

export function blockUser(userId: string): Promise<{ blocked: boolean }> {
  return callApi((client) => client.blocks.block({ params: { userId } }));
}

export function unblockUser(userId: string): Promise<{ blocked: boolean }> {
  return callApi((client) => client.blocks.unblock({ params: { userId } }));
}

export async function listBlockedUsers(): Promise<BlockedPerson[]> {
  const { blocked } = await callApi((client) => client.blocks.list());
  return [...blocked];
}

// --- Public groups and channels (T-0164) -----------------------------------
// A public group or channel holds its own `@handle` (the same namespace as
// `@username`s), appears in the directory, and joins with one tap. A
// private group stays invisible and invite-only, exactly as before.

export type { DirectoryEntry };

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
  // An empty `q` or `cursor` is left out, like before.
  const query = {
    ...(input.q === undefined || input.q === '' ? {} : { q: input.q }),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.cursor === undefined || input.cursor === '' ? {} : { cursor: input.cursor }),
  };
  return callApi((client) => client.directory.search({ query })).then((page) => ({
    entries: [...page.entries],
    next: page.next,
  }));
}

// Exact match of one public group by `@handle` (case-insensitive). A
// private group and an unknown handle answer the same 404.
export function lookupGroupByHandle(handle: string): Promise<DirectoryEntry> {
  return callApi((client) => client.directory.byHandle({ params: { handle } }));
}

export type PublicJoinResult = GroupJoinResult;

// Joins a public group or channel with one request (private or unknown
// answers the same 404; a full group 409 `group_full`; joining twice is
// harmless with `alreadyMember: true`).
export function joinPublicGroup(groupId: string): Promise<PublicJoinResult> {
  return callApi((client) => client.groups.join({ params: { id: groupId } }));
}

// Owner-only: flips a group public (with a handle) or back to private.
// Unique violations map to 409 `handle_taken`; the 14-day interval to 409
// `handle_change_too_soon` with `nextChangeAt` in the error detail.
export function setGroupVisibility(
  groupId: string,
  input: { visibility: 'private' | 'public'; handle?: string },
): Promise<GroupDetail> {
  return callApi((client) =>
    client.groups.patch({ params: { id: groupId }, payload: omitUndefined(input) }),
  );
}

// Live availability of a handle for a public group or channel (the same
// shape, reserved words and uniqueness as `@username`s; the asker's own
// group reservation counts as available).
export function checkGroupHandle(handle: string): Promise<HandleCheck> {
  return checkHandleKind(handle, 'group');
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
    response = await (
      await loadMockRequest()
    )(path, {
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
    throw apiErrorFromBody(response.status, raw);
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
// The schemas live in `@zilar/api-contract` (`backgrounds.ts`, T-0895). The
// upload stays outside the derived client: it posts raw image bytes.
export type { BackgroundImage, BackgroundListItem };

// The POST twin of `uploadAvatarBytes`: a raw-body fetch with a mock branch,
// `apiErrorFromBody` on failure and an Effect Schema parse of the reply.
export async function uploadBackground(blob: Blob): Promise<BackgroundImage> {
  let response: Response;
  if (isMockApiEnabled()) {
    response = await (
      await loadMockRequest()
    )('/backgrounds', {
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
    throw apiErrorFromBody(response.status, raw);
  }
  const parsed = decodeResponse(BackgroundImageSchema, raw);
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
  return callApi((client) => client.backgrounds.list()).then((body) => [...body.backgrounds]);
}

export async function deleteBackground(id: string): Promise<void> {
  await callApi((client) => client.backgrounds.remove({ params: { id } }));
}
