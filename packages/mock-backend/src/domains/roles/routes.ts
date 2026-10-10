// The `/api/groups/:id/roles` group (T-0943, the contract's `roles.ts`): custom
// group roles with their holders, mirroring web's mock (`groupRoles` range).
// Reads need group membership; every write needs an owner or admin, and the
// mock's single user owns the seeded groups.
import type { GroupRole } from '@zilar/api-contract';
import type { MockData } from '../../state';
import {
  badRequest,
  conflict,
  jsonResponse,
  noContent,
  notFound,
  readJsonBody,
  type MockHttpRequest,
} from '../../http/shared';
import type { MockGroupRole } from './tables';

const ROLE_NAME_MAX = 30;
const ROLES_MAX = 20;

export function handleRoles(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments[0] !== 'groups' || request.segments[2] !== 'roles') {
    return undefined;
  }
  const groupId = decodeURIComponent(request.segments[1] ?? '');
  if (data.findGroup(groupId) === undefined) {
    return notFound('Group not found');
  }
  const roleId = request.segments[3];
  const action = request.segments[4];
  if (roleId === undefined) {
    if (request.method === 'GET') return listRoles(data, groupId);
    if (request.method === 'POST') return createRole(data, groupId, request);
    return undefined;
  }
  const role = data.findGroupRole(decodeURIComponent(roleId));
  if (role === undefined || role.groupId !== groupId) {
    return notFound('Role not found');
  }
  if (action === undefined) {
    if (request.method === 'PATCH') return renameRole(data, groupId, role, request);
    if (request.method === 'DELETE') return removeRole(data, groupId, role);
    return undefined;
  }
  if (action === 'members' && request.method === 'PUT') {
    return setRoleMembers(data, role, request);
  }
  return undefined;
}

function listRoles(data: MockData, groupId: string): Response {
  const roles = data.groupRoles.filter((role) => role.groupId === groupId);
  return jsonResponse({ roles: roles.map((role) => roleView(data, role)) });
}

function createRole(data: MockData, groupId: string, request: MockHttpRequest): Response {
  const name = readRoleName(request);
  if (name === null) {
    return badRequest('invalid_request', 'name must not be empty');
  }
  const roles = data.groupRoles.filter((role) => role.groupId === groupId);
  if (roles.some((role) => role.name.toLowerCase() === name.toLowerCase())) {
    return conflict('role_exists', 'A role with that name already exists');
  }
  if (roles.length >= ROLES_MAX) {
    return badRequest('invalid_request', 'A group has at most 20 roles');
  }
  const created: MockGroupRole = { id: data.nextRoleId(), groupId, name, memberIds: [] };
  data.putGroupRole(created);
  return jsonResponse(roleView(data, created), 201);
}

function renameRole(
  data: MockData,
  groupId: string,
  role: MockGroupRole,
  request: MockHttpRequest,
): Response {
  const name = readRoleName(request);
  if (name === null) {
    return badRequest('invalid_request', 'name must not be empty');
  }
  if (
    data.groupRoles.some(
      (item) =>
        item.groupId === groupId &&
        item.id !== role.id &&
        item.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    return conflict('role_exists', 'A role with that name already exists');
  }
  const updated: MockGroupRole = { ...role, name };
  data.putGroupRole(updated);
  return jsonResponse(roleView(data, updated));
}

// Deleting a role detaches it from every topic of the group and clears it as an
// approver, like web's mock and the server.
function removeRole(data: MockData, groupId: string, role: MockGroupRole): Response {
  data.removeGroupRole(role.id);
  for (const topic of data.topics) {
    if (topic.groupId !== groupId) continue;
    const roleIds = topic.roleIds.filter((id) => id !== role.id);
    const approverRoleId = topic.approverRoleId === role.id ? null : topic.approverRoleId;
    if (roleIds.length !== topic.roleIds.length || approverRoleId !== topic.approverRoleId) {
      data.putTopic({ ...topic, roleIds, approverRoleId });
    }
  }
  return noContent();
}

function setRoleMembers(data: MockData, role: MockGroupRole, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const memberIds = unique(readStringArray(body.userIds));
  const updated: MockGroupRole = { ...role, memberIds };
  data.putGroupRole(updated);
  return jsonResponse(roleView(data, updated));
}

function roleView(data: MockData, role: MockGroupRole): GroupRole {
  return {
    id: role.id,
    name: role.name,
    members: role.memberIds.map((userId) => ({ userId, name: personName(data, userId) })),
  };
}

function readRoleName(request: MockHttpRequest): string | null {
  const body = readJsonBody(request.init);
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, ROLE_NAME_MAX) : '';
  if (name === '' || hasControlCharacters(name)) {
    return null;
  }
  return name;
}

function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
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
