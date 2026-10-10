// The `/api/groups` group (T-0943): create, detail, members and settings, with
// the same bodies and mutations as web's mock (`apps/web/src/mock/api.ts` group
// ranges). The public-group `by-handle` lookup and join, and the invite-link
// routes, belong to neighbouring domains and are left untouched here.
import type { GroupAi, GroupMember } from '@zilar/api-contract';
import { classifyHandle, normalizeHandle } from '@zilar/protocol';
import type { MockData } from '../../state';
import {
  badRequest,
  conflict,
  jsonResponse,
  notFound,
  readJsonBody,
  type MockHttpRequest,
} from '../../http/shared';
import type { MockGroup } from './tables';

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
  if (RESERVED_GROUP_PATHS.has(groupId) || sub === 'topics' || sub === 'roles') {
    return undefined;
  }
  const group = data.findGroup(groupId);
  if (group === undefined) {
    return notFound('Group not found');
  }
  if (sub === undefined) {
    if (request.method === 'GET') return jsonResponse(group);
    if (request.method === 'PATCH') return patchGroup(data, group, request);
    return undefined;
  }
  if (sub === 'members') return handleMembers(data, group, request);
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
  const group: MockGroup = {
    id: data.nextGroupId(),
    title,
    createdBy: managerId,
    membersCanCreateTopics: false,
    visibility: 'private',
    handle: null,
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
  return jsonResponse(group, 201);
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

function handleMembers(
  data: MockData,
  group: MockGroup,
  request: MockHttpRequest,
): Response | undefined {
  const subId = request.segments[3];
  const action = request.segments[4];
  if (subId === undefined) {
    if (request.method === 'GET') {
      return jsonResponse({ members: group.members.map(memberView) });
    }
    if (request.method === 'POST') return addMembers(data, group, request);
    return undefined;
  }
  const userId = decodeURIComponent(subId);
  if (action === 'role' && request.method === 'PUT') {
    return changeRole(data, group, userId, request);
  }
  if (action === undefined && request.method === 'DELETE') {
    return removeMember(data, group, userId);
  }
  return undefined;
}

function addMembers(data: MockData, group: MockGroup, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const existing = new Set(group.members.map((member) => member.userId));
  const added = unique(readStringArray(body.userIds))
    .filter((userId) => !existing.has(userId))
    .map((userId): GroupMember => ({
      userId,
      name: personName(data, userId),
      role: 'member',
      roles: [],
    }));
  group.members = [...group.members, ...added];
  return jsonResponse(group);
}

// Mirrors web's mock: only a channel owner changes roles, and a channel always
// keeps one admin. A viewer or a target that may not act answers the missing-404.
function changeRole(
  data: MockData,
  group: MockGroup,
  userId: string,
  request: MockHttpRequest,
): Response {
  const viewer = group.members.find((member) => member.userId === data.me.id);
  if (viewer === undefined || viewer.role !== 'owner' || group.kind !== 'channel') {
    return notFound('Group not found');
  }
  const member = group.members.find((item) => item.userId === userId);
  if (member === undefined) {
    return notFound('That user is not a member');
  }
  const body = readJsonBody(request.init);
  if (body.role !== 'admin' && body.role !== 'member') {
    return badRequest('invalid_request', 'role must be admin or member');
  }
  if (member.role === 'owner' || userId === data.me.id) {
    return badRequest('invalid_request', 'The owner cannot change roles');
  }
  if (
    body.role === 'member' &&
    !group.members.some((item) => item.userId !== userId && item.role === 'admin')
  ) {
    return conflict('channel_needs_admin', 'A channel needs an admin');
  }
  group.members = group.members.map((item) =>
    item.userId === userId ? { ...item, role: body.role as 'admin' | 'member' } : item,
  );
  return jsonResponse(group);
}

// Mirrors web's mock: leaving is always allowed, removing someone else needs a
// manager, the owner cannot be removed, and a channel keeps one admin.
function removeMember(data: MockData, group: MockGroup, userId: string): Response {
  const viewer = group.members.find((member) => member.userId === data.me.id);
  const target = group.members.find((item) => item.userId === userId);
  if (target === undefined || viewer === undefined) {
    return notFound('That user is not a member');
  }
  const isManager = viewer.role === 'owner' || viewer.role === 'admin';
  if (userId !== data.me.id && !isManager) {
    return jsonResponse({ error: { code: 'forbidden', message: 'Forbidden' } }, 403);
  }
  if (target.role === 'owner') {
    return badRequest('invalid_request', 'The owner cannot be removed');
  }
  if (
    group.kind === 'channel' &&
    target.role === 'admin' &&
    userId !== data.me.id &&
    !group.members.some((item) => item.userId !== userId && item.role === 'admin')
  ) {
    return conflict('channel_needs_admin', 'A channel needs an admin');
  }
  group.members = group.members.filter((item) => item.userId !== userId);
  return jsonResponse(group);
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

function memberView(member: GroupMember): GroupMember {
  return {
    userId: member.userId,
    name: member.name,
    role: member.role,
    roles: member.roles ?? [],
    ...(member.handle === undefined || member.handle === null ? {} : { handle: member.handle }),
  };
}

function personName(data: MockData, userId: string): string {
  return data.people.find((person) => person.id === userId)?.name ?? 'Someone';
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
