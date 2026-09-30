import { describe, expect, it } from 'vitest';

import {
  approverLine,
  approverOptions,
  attachedRoleIds,
  deleteRoleConfirmText,
  describeRolesError,
  membersWithChips,
  mayManageRoles,
  rolesByUserId,
  showsTopicAccess,
  sortGroupRoles,
  topicAccessRows,
  topicRoleLabel,
  ROLE_WRITE_DENIED_MESSAGE,
} from './roles';
import type { CustomGroupRole } from './roles-api';

function role(id: string, name: string, memberIds: string[] = []): CustomGroupRole {
  return {
    id,
    name,
    members: memberIds.map((userId) => ({ userId, name: userId })),
  };
}

describe('mayManageRoles', () => {
  it('lets owners and admins manage, members only read', () => {
    expect(mayManageRoles('owner')).toBe(true);
    expect(mayManageRoles('admin')).toBe(true);
    expect(mayManageRoles('member')).toBe(false);
    expect(mayManageRoles(undefined)).toBe(false);
  });
});

describe('describeRolesError', () => {
  it('maps 403 and 404 writes to the neutral denied line', () => {
    expect(describeRolesError({ status: 403, code: 'forbidden' })).toBe(ROLE_WRITE_DENIED_MESSAGE);
    expect(describeRolesError({ status: 404, code: 'not_found' })).toBe(ROLE_WRITE_DENIED_MESSAGE);
  });

  it('passes anything else through', () => {
    expect(describeRolesError(new Error('offline'))).toBe('offline');
    expect(describeRolesError({ status: 400, code: 'invalid_request' })).toBe(
      'Could not save the roles. Try again.',
    );
  });
});

describe('labels', () => {
  it('names attached roles with their holder count', () => {
    expect(topicRoleLabel({ id: 'r1', name: 'Designers', memberCount: 3 })).toBe('Designers (3)');
  });

  it('reads the approver line, or nothing without an approver role', () => {
    expect(approverLine({ id: 'r1', name: 'Designers' })).toBe('Approvers: Designers');
    expect(approverLine(null)).toBeUndefined();
  });

  it('says what a delete removes', () => {
    const text = deleteRoleConfirmText('Designers');
    expect(text).toContain('Designers');
    expect(text).toContain('lose');
  });
});

describe('sortGroupRoles', () => {
  it('sorts by name', () => {
    expect(
      sortGroupRoles([role('r2', 'Devs'), role('r1', 'Designers')]).map((entry) => entry.id),
    ).toEqual(['r1', 'r2']);
  });
});

describe('rolesByUserId and membersWithChips', () => {
  const roles = [role('r1', 'Designers', ['u-me', 'u-ana']), role('r2', 'Devs', ['u-me'])];

  it('maps each holder to the roles they hold', () => {
    const byUser = rolesByUserId(roles);
    expect(byUser.get('u-me')?.map((entry) => entry.id)).toEqual(['r1', 'r2']);
    expect(byUser.get('u-ana')?.map((entry) => entry.id)).toEqual(['r1']);
    expect(byUser.get('u-luis')).toBeUndefined();
  });

  it('prefers the fresh list over the detail snapshot', () => {
    const members = membersWithChips(
      [
        { userId: 'u-me', name: 'Me', role: 'owner', roles: [{ id: 'stale', name: 'Stale' }] },
        { userId: 'u-luis', name: 'Luis', role: 'member', roles: [{ id: 'stale', name: 'Stale' }] },
      ],
      roles,
    );
    expect(members[0]?.chips.map((chip) => chip.id)).toEqual(['r1', 'r2']);
    // Luis holds nothing fresh: the snapshot must not leak through.
    expect(members[1]?.chips).toEqual([]);
  });

  it('falls back to the snapshot before the first roles load', () => {
    const members = membersWithChips(
      [{ userId: 'u-me', name: 'Me', role: 'owner', roles: [{ id: 'r1', name: 'Designers' }] }],
      undefined,
    );
    expect(members[0]?.chips).toEqual([{ id: 'r1', name: 'Designers' }]);
  });
});

describe('topicAccessRows', () => {
  const attached = [{ id: 'r1', name: 'Designers', memberCount: 2 }];

  it('lists attached roles first, then the roles a manager may add', () => {
    const rows = topicAccessRows('private', attached, [
      role('r2', 'Devs', ['u-me']),
      role('r1', 'Designers', ['u-me', 'u-ana']),
    ]);
    expect(rows).toEqual([
      { id: 'r1', label: 'Designers (2)', attached: true },
      { id: 'r2', label: 'Devs (1)', attached: false },
    ]);
  });

  it('shows no rows for public topics', () => {
    expect(topicAccessRows('public', attached, [role('r2', 'Devs')])).toEqual([]);
    expect(showsTopicAccess('public')).toBe(false);
    expect(showsTopicAccess('private')).toBe(true);
  });
});

describe('approverOptions', () => {
  const attached = [
    { id: 'r1', name: 'Designers', memberCount: 2 },
    { id: 'r2', name: 'Devs', memberCount: 1 },
  ];

  it('offers owner-and-admins plus one option per attached role', () => {
    expect(approverOptions(attached, null)).toEqual([
      { id: null, label: 'Owner and admins only', selected: true },
      { id: 'r1', label: 'Designers', selected: false },
      { id: 'r2', label: 'Devs', selected: false },
    ]);
    expect(approverOptions(attached, { id: 'r2', name: 'Devs' })[2]).toMatchObject({
      selected: true,
    });
  });
});

describe('attachedRoleIds', () => {
  it('collects the ids for the replace-the-set PUT', () => {
    expect(
      attachedRoleIds([
        { id: 'r1', name: 'Designers', memberCount: 2 },
        { id: 'r2', name: 'Devs', memberCount: 1 },
      ]),
    ).toEqual(['r1', 'r2']);
  });
});
