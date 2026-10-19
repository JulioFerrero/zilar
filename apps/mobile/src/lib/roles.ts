import type { GroupRole } from './chat-api';
import type { CustomGroupRole } from './roles-api';
import type { ApproverRole, TopicRole } from './topics-api';
import type { TopicVisibility } from '@zilar/chat-core';

/** A 403 reads the same to a stranger or a plain member: a neutral message that reveals nothing. */
export const ROLE_WRITE_DENIED_MESSAGE = 'Only group owners and admins can change roles.';

/** The group or role is gone (deleted elsewhere, a stale cache); retryable, so it says to refresh. */
export const ROLE_GONE_MESSAGE =
  'This group or role is no longer available. Refresh and try again.';

export const ROLE_SAVE_FAILED_MESSAGE = 'Could not save the roles. Try again.';

export const ROLE_LOAD_FAILED_MESSAGE = 'Could not load the roles. Try again.';

export type RolesFailure = 'write' | 'load';

export function mayManageRoles(viewerRole: 'owner' | 'admin' | 'member' | undefined): boolean {
  return viewerRole === 'owner' || viewerRole === 'admin';
}

function rolesStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = error.status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

/**
 * A 404 on a write is the neutral denied line too: the server answers the same 404 for unknown and hidden ids, so "not found" would leak. A 404 on a load means it is genuinely gone; anything else is a generic retry line.
 */
export function describeRolesError(error: unknown, failure: RolesFailure): string {
  const status = rolesStatus(error);
  if (status === 403) {
    return ROLE_WRITE_DENIED_MESSAGE;
  }
  if (status === 404) {
    return failure === 'write' ? ROLE_WRITE_DENIED_MESSAGE : ROLE_GONE_MESSAGE;
  }
  return failure === 'write' ? ROLE_SAVE_FAILED_MESSAGE : ROLE_LOAD_FAILED_MESSAGE;
}

export function topicRoleLabel(role: TopicRole): string {
  return `${role.name} (${role.memberCount})`;
}

export function approverLine(approver: ApproverRole | null): string | undefined {
  return approver === null ? undefined : `Approvers: ${approver.name}`;
}

export function deleteRoleConfirmText(roleName: string): string {
  return `Delete “${roleName}”? Its members lose the topics it opens and its approver rights.`;
}

export function attachedRoleIds(roles: readonly TopicRole[]): string[] {
  return roles.map((role) => role.id);
}

export function sortGroupRoles<T extends Pick<CustomGroupRole, 'name'>>(roles: readonly T[]): T[] {
  return [...roles].sort((left, right) => left.name.localeCompare(right.name));
}

export function rolesByUserId(roles: readonly CustomGroupRole[]): Map<string, TopicRole[]> {
  const byUser = new Map<string, TopicRole[]>();
  for (const role of roles) {
    for (const holder of role.members) {
      const list = byUser.get(holder.userId) ?? [];
      list.push({ id: role.id, name: role.name, memberCount: role.members.length });
      byUser.set(holder.userId, list);
    }
  }
  return byUser;
}

export interface MemberWithChips {
  userId: string;
  name: string;
  role: GroupRole;
  /** The fresh roles list wins over the group detail's snapshot. */
  chips: { id: string; name: string }[];
}

/**
 * Once the fresh roles list has loaded it wins everywhere: a member absent from it holds nothing, and the detail snapshot must not leak through.
 */
export function membersWithChips(
  members: readonly {
    userId: string;
    name: string;
    role: GroupRole;
    roles?: { id: string; name: string }[];
  }[],
  freshRoles: readonly CustomGroupRole[] | undefined,
): MemberWithChips[] {
  const byUser = freshRoles === undefined ? undefined : rolesByUserId(freshRoles);
  return members.map((member) => ({
    userId: member.userId,
    name: member.name,
    role: member.role,
    chips: byUser === undefined ? (member.roles ?? []) : (byUser.get(member.userId) ?? []),
  }));
}

export interface TopicAccessRow {
  id: string;
  label: string;
  attached: boolean;
}

/**
 * Public topics get no rows at all; the sheet says so instead of showing controls.
 */
export function topicAccessRows(
  visibility: TopicVisibility,
  attached: readonly TopicRole[],
  groupRoles: readonly CustomGroupRole[],
): TopicAccessRow[] {
  if (visibility !== 'private') {
    return [];
  }
  const attachedIds = new Set(attached.map((role) => role.id));
  const rows = attached.map((role) => ({
    id: role.id,
    label: topicRoleLabel(role),
    attached: true,
  }));
  for (const role of sortGroupRoles(groupRoles)) {
    if (!attachedIds.has(role.id)) {
      rows.push({
        id: role.id,
        label: topicRoleLabel({ ...role, memberCount: role.members.length }),
        attached: false,
      });
    }
  }
  return rows;
}

export interface ApproverOption {
  id: string | null;
  label: string;
  selected: boolean;
}

export function approverOptions(
  attached: readonly TopicRole[],
  approver: ApproverRole | null,
): ApproverOption[] {
  const options: ApproverOption[] = [
    { id: null, label: 'Owner and admins only', selected: approver === null },
  ];
  for (const role of attached) {
    options.push({ id: role.id, label: role.name, selected: approver?.id === role.id });
  }
  return options;
}
