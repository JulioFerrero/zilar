// The `/api/groups` group (T-0943): create, detail and settings, with the same
// bodies and mutations as web's mock (`apps/web/src/mock/api.ts` group ranges).
// The member and ownership handlers live in `members-routes.ts`. The public-group
// `by-handle` lookup and join, and the invite-link routes, belong to neighbouring
// domains and are left untouched here.
import type { GroupAi, GroupChatEntry } from '@zilar/api-contract';
import { classifyHandle, normalizeHandle } from '@zilar/protocol';
import type { MockData } from '../../state';
import { generalTopicRow, groupRoomJid } from '../chats/general-topics';
import { addChat } from '../directory/groups';
import {
  badRequest,
  conflict,
  jsonResponse,
  noContent,
  notFound,
  readJsonBody,
  type MockHttpRequest,
} from '../../http/shared';
import type { MockGroup } from './tables';
import {
  handleMembers,
  personName,
  readStringArray,
  transferOwner,
  unique,
} from './members-routes';

// `/groups/<name>` paths owned by other domains, so this handler lets them
// through (their routes run after the groups domain in the registry order).
const RESERVED_GROUP_PATHS = new Set(['by-handle', 'invite-links']);

export function handleGroups(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments[0] !== 'groups') {
    return undefined;
  }
  const id = request.segments[1];
  const sub = request.segments[2];
  if (id === undefined) {
    return request.method === 'POST' ? createGroup(data, request) : undefined;
  }
  const groupId = decodeURIComponent(id);
  if (
    RESERVED_GROUP_PATHS.has(groupId) ||
    sub === 'topics' ||
    sub === 'roles' ||
    sub === 'invite-links' ||
    sub === 'join'
  ) {
    return undefined;
  }
  const group = data.findGroup(groupId);
  if (group === undefined) {
    return notFound('Group not found');
  }
  if (sub === undefined) {
    if (request.method === 'GET') return jsonResponse(group);
    if (request.method === 'PATCH') return patchGroup(data, group, request);
    if (request.method === 'DELETE') return deleteGroup(data, group);
    return undefined;
  }
  if (sub === 'members') return handleMembers(data, group, request);
  if (sub === 'owner') {
    return request.method === 'PUT' ? transferOwner(data, group, request) : undefined;
  }
  if (sub === 'ais') return handleGroupAis(data, group, request);
  return undefined;
}

function createGroup(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 100) : '';
  if (title === '') {
    return badRequest('invalid_request', 'title must not be empty');
  }
  const kind = body.kind === 'channel' ? 'channel' : 'group';
  const description =
    typeof body.description === 'string' && body.description.trim() !== ''
      ? body.description.trim().slice(0, 300)
      : null;
  const memberIds = readStringArray(body.memberIds).filter((userId) => userId !== data.me.id);
  const managerId = data.me.id;
  const groupId = data.nextGroupId();
  // T-1314 fix 1: the step-2 screen sends `visibility` + `handle`
  // (`buildGroupCreateInput`) and the real server claims the public handle in
  // the create transaction (`apps/server/src/groups/service.ts:173-199`). The
  // mock stored every group `private`/`handle: null`, so a Public group the
  // user made did not exist. Validate and store the claim like `patchGroup`.
  const publicGroup = body.visibility === 'public';
  const rawHandle = typeof body.handle === 'string' ? body.handle.trim() : '';
  if (publicGroup) {
    const reason = handleReason(rawHandle, groupId);
    if (reason === 'invalid') {
      return badRequest('handle_invalid', 'That handle is not available');
    }
    if (reason !== null) {
      return conflict(
        reason === 'reserved' ? 'handle_reserved' : 'handle_taken',
        'That handle is not available',
      );
    }
  }
  const group: MockGroup = {
    id: groupId,
    title,
    createdBy: managerId,
    membersCanCreateTopics: false,
    visibility: publicGroup ? 'public' : 'private',
    handle: publicGroup ? rawHandle : null,
    members: [
      { userId: managerId, name: personName(data, managerId), role: 'owner', roles: [] },
      ...unique(memberIds).map((userId) => ({
        userId,
        name: personName(data, userId),
        role: 'member' as const,
        roles: [],
      })),
    ],
    ais: [],
  };
  if (kind === 'channel') {
    group.kind = 'channel';
    group.description = description;
  }
  data.putGroup(group);
  // T-1314: the created group joins the caller's chat list and gets its General
  // topic in the group's own room, the way the server does in the same
  // transaction (`apps/server/src/groups/service.ts:157-171`). Without the chat
  // row `/api/chats` never carried the new group, so the group screen after
  // Create bounced straight back to the list.
  const chatJid = groupRoomJid(group.id);
  addChat(data, chatEntryOf(group, chatJid));
  data.putTopic(generalTopicRow(group.id, chatJid));
  return jsonResponse(group, 201);
}

/** The `/chats` row of a freshly created group: the creator owns it. */
function chatEntryOf(group: MockGroup, chatJid: string): GroupChatEntry {
  const memberCount = group.members.length;
  return {
    kind: 'group',
    chatJid,
    title: group.title,
    groupId: group.id,
    memberCount,
    role: 'owner',
    visibility: group.visibility,
    handle: group.handle ?? null,
    // T-1318: stamp the creation time so the chat list sorts the group first
    // while it has no messages, the way Telegram does (the real server sends
    // the group row's `created_at`, `apps/server/src/groups/queries.ts:55`).
    createdAt: new Date().toISOString(),
    ...(group.kind === 'channel'
      ? {
          chatKind: 'channel' as const,
          subscriberCount: memberCount,
          description: group.description ?? null,
        }
      : {}),
  };
}

function patchGroup(data: MockData, group: MockGroup, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  let updated = group;
  if (typeof body.membersCanCreateTopics === 'boolean') {
    updated = { ...updated, membersCanCreateTopics: body.membersCanCreateTopics };
  }
  if (typeof body.listenerEnabled === 'boolean') {
    updated = {
      ...updated,
      listener: {
        enabled: body.listenerEnabled,
        eagerness: updated.listener?.eagerness ?? 'normal',
        available: true,
      },
    };
  }
  if (
    body.listenerEagerness === 'quiet' ||
    body.listenerEagerness === 'normal' ||
    body.listenerEagerness === 'eager'
  ) {
    updated = {
      ...updated,
      listener: {
        enabled: updated.listener?.enabled ?? false,
        eagerness: body.listenerEagerness,
        available: true,
      },
    };
  }
  if (
    body.background !== undefined &&
    body.background !== null &&
    typeof body.background === 'object'
  ) {
    const raw = body.background as Record<string, unknown>;
    updated = {
      ...updated,
      background: {
        backgroundPreset: typeof raw.backgroundPreset === 'string' ? raw.backgroundPreset : null,
        backgroundImageId: typeof raw.backgroundImageId === 'string' ? raw.backgroundImageId : null,
        backgroundDim: typeof raw.backgroundDim === 'number' ? raw.backgroundDim : null,
      },
    };
  }
  if (body.visibility === 'private') {
    updated = { ...updated, visibility: 'private', handle: null };
  } else if (body.visibility === 'public') {
    const raw = typeof body.handle === 'string' ? body.handle.trim() : '';
    const reason = handleReason(raw, group.id);
    if (reason === 'invalid') {
      return badRequest('handle_invalid', 'That handle is not available');
    }
    if (reason !== null) {
      return conflict(
        reason === 'reserved' ? 'handle_reserved' : 'handle_taken',
        'That handle is not available',
      );
    }
    updated = { ...updated, visibility: 'public', handle: raw };
  }
  data.putGroup(updated);
  return jsonResponse(updated);
}

/** The mock's handle availability: shape/reserved from `@zilar/protocol`, plus two taken words. */
function handleReason(raw: string, groupId: string): 'invalid' | 'reserved' | 'taken' | null {
  const reason = classifyHandle(raw);
  if (reason !== null) {
    return reason;
  }
  const normalized = normalizeHandle(raw);
  if (normalized === 'taken_user' || (normalized === 'acme' && groupId !== 'g-acme')) {
    return 'taken';
  }
  return null;
}

// T-1243: only the owner deletes a group. A member or admin answers 403, and a
// non-member the same 404 as an unknown group, like the server route.
function deleteGroup(data: MockData, group: MockGroup): Response {
  const viewer = group.members.find((member) => member.userId === data.me.id);
  if (viewer === undefined) {
    return notFound('Group not found');
  }
  if (viewer.role !== 'owner') {
    return jsonResponse({ error: { code: 'forbidden', message: 'Forbidden' } }, 403);
  }
  data.removeGroup(group.id);
  return noContent();
}

function handleGroupAis(
  data: MockData,
  group: MockGroup,
  request: MockHttpRequest,
): Response | undefined {
  const subId = request.segments[3];
  if (subId === undefined) {
    return request.method === 'POST' ? addGroupAi(data, group, request) : undefined;
  }
  if (request.method !== 'DELETE') {
    return undefined;
  }
  const aiId = decodeURIComponent(subId);
  group.ais = group.ais.filter((entry) => entry.aiId !== aiId);
  return jsonResponse(group);
}

function addGroupAi(data: MockData, group: MockGroup, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const aiId = typeof body.aiId === 'string' ? body.aiId : '';
  const owned = data.ais.find((entry) => entry.id === aiId);
  if (owned === undefined) {
    return badRequest('invalid_request', 'Unknown AI');
  }
  if (!group.ais.some((entry) => entry.aiId === aiId)) {
    const added: GroupAi = {
      aiId,
      jid: owned.jid,
      name: owned.name,
      ownerId: data.me.id,
    };
    group.ais = [...group.ais, added];
  }
  return jsonResponse(group);
}
