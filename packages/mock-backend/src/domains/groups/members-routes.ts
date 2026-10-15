// The member and ownership handlers of `/api/groups` (T-0943): listing and
// adding members, role changes, removal and the owner transfer. `routes.ts`
// dispatches to `handleMembers` and `transferOwner`; the small helpers they
// share with the group handlers in `routes.ts` live here too.
import type { GroupMember } from '@zilar/api-contract';
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

export function handleMembers(
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

// T-1190/T-1251: only the owner hands the group over. The target (a member)
// becomes owner and the actor an admin. A non-owner caller answers 403, an
// unknown target the member-404, and handing it to yourself a 400, like the
// server route.
export function transferOwner(
  data: MockData,
  group: MockGroup,
  request: MockHttpRequest,
): Response {
  const viewer = group.members.find((member) => member.userId === data.me.id);
  if (viewer === undefined) {
    return notFound('Group not found');
  }
  if (viewer.role !== 'owner') {
    return jsonResponse({ error: { code: 'forbidden', message: 'Forbidden' } }, 403);
  }
  const body = readJsonBody(request.init);
  const userId = typeof body.userId === 'string' ? body.userId : '';
  if (userId === data.me.id) {
    return badRequest('invalid_request', 'You already own this group');
  }
  const target = group.members.find((member) => member.userId === userId);
  if (target === undefined) {
    return notFound('That user is not a member of this group');
  }
  group.members = group.members.map((member) =>
    member.userId === userId
      ? { ...member, role: 'owner' }
      : member.userId === data.me.id
        ? { ...member, role: 'admin' }
        : member,
  );
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

export function personName(data: MockData, userId: string): string {
  return data.people.find((person) => person.id === userId)?.name ?? 'Someone';
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
