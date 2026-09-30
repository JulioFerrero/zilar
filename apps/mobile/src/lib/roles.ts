import type { GroupRole } from './chat-api';
import type { CustomGroupRole } from './roles-api';
import type { ApproverRole, TopicRole, TopicVisibility } from './topics-api';

/**
 * Plain role helpers (T-0137), the mobile twin of the web `GroupPanel` /
 * `TopicPanel` roles behaviour: who may manage roles, how API errors read to
 * a group member, and which topic role controls render for a visibility.
 * Components stay thin; everything here is a pure function with Vitest
 * coverage.
 */

/** A 403 on any roles call reads the same to a stranger or a plain member:
 *  a neutral message that reveals nothing. */
export const ROLE_WRITE_DENIED_MESSAGE = 'Only group owners and admins can change roles.';

/** A 404 on a roles load: the group or role is gone (deleted elsewhere, a
 *  stale cache). Retryable, so it says to refresh. */
export const ROLE_GONE_MESSAGE =
  'This group or role is no longer available. Refresh and try again.';

/** Any other roles write failure: generic, never the raw server message. */
export const ROLE_SAVE_FAILED_MESSAGE = 'Could not save the roles. Try again.';

/** Any other roles load failure: generic, never the raw server message. */
export const ROLE_LOAD_FAILED_MESSAGE = 'Could not load the roles. Try again.';

export type RolesFailure = 'write' | 'load';

/** Whether the viewer manages roles (create, rename, delete, assign). */
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
 * Maps a roles/topic-roles store failure to the message the UI shows. A 403
 * is always the neutral denied line, and so is a 404 on a write (the server
 * answers the same 404 for unknown and for hidden ids, so "not found" would
 * leak). A 404 on a load means the thing is genuinely gone, so it reads as
 * refresh-and-retry. Anything else is a generic retry line — raw server
 * messages never reach the UI.
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

/** "Designers (3)": an attached role with its holder count. */
export function topicRoleLabel(role: TopicRole): string {
  return `${role.name} (${role.memberCount})`;
}

/** "Approvers: Designers": the read-only approver line for non-managers. */
export function approverLine(approver: ApproverRole | null): string | undefined {
  return approver === null ? undefined : `Approvers: ${approver.name}`;
}

/** The delete confirm names what the delete removes: holders lose access. */
export function deleteRoleConfirmText(roleName: string): string {
  return `Delete “${roleName}”? Its members lose the topics it opens and its approver rights.`;
}

/** Attached role ids for the `/api/topics/:id/roles` replace-the-set PUT. */
export function attachedRoleIds(roles: readonly TopicRole[]): string[] {
  return roles.map((role) => role.id);
}

/** Sorts roles by name for the list, like the server's `rolesOfTopic`. */
export function sortGroupRoles<T extends Pick<CustomGroupRole, 'name'>>(roles: readonly T[]): T[] {
  return [...roles].sort((left, right) => left.name.localeCompare(right.name));
}

/** userId -> the custom roles they hold, for the chips next to member names. */
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
  /** The chips next to the member's name: the fresh roles list wins over the
   *  group detail's snapshot, so chips stay right after an assignment. */
  chips: { id: string; name: string }[];
}

/**
 * Members with their role chips. Everyone sees the same chips (role
 * membership is not secret); managers additionally get the CRUD section.
 * Once the fresh roles list has loaded it wins everywhere: a member absent
 * from it holds nothing, and the detail snapshot must not leak through.
 * Before the first load the snapshot fills in, so chips still show.
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

/** One attached role row of the topic access picker. */
export interface TopicAccessRow {
  id: string;
  label: string;
  attached: boolean;
}

/**
 * The topic access picker rows: attached roles first ("Designers (3)"), then
 * the group's other roles a manager may add. Public topics get no rows at
 * all — the sheet says so instead of showing controls.
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

/** One approver option: "Owner and admins only" or an attached role. */
export interface ApproverOption {
  id: string | null;
  label: string;
  selected: boolean;
}

/** The approver picker options. Managers edit; everyone else reads the line. */
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
