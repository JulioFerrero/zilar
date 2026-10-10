import type { MockSeed } from '../../data';
import type { MockData } from '../../state';
import type { MockGroupRole } from './tables';

/**
 * The custom group roles table and its mutators. Rows are cloned from the seed
 * and every array is replaced, never mutated in place, so a `reset()` cannot
 * leak a previous seed.
 */
export function createRolesState(seed: MockSeed): Partial<MockData> {
  let roles: MockGroupRole[] = seed.groupRoles.map((role) => ({
    ...role,
    memberIds: [...role.memberIds],
  }));
  let roleSequence = 3;
  return {
    get groupRoles(): readonly MockGroupRole[] {
      return roles;
    },
    findGroupRole(id: string): MockGroupRole | undefined {
      return roles.find((role) => role.id === id);
    },
    putGroupRole(role: MockGroupRole): void {
      roles = roles.some((item) => item.id === role.id)
        ? roles.map((item) => (item.id === role.id ? role : item))
        : [...roles, role];
    },
    removeGroupRole(id: string): void {
      roles = roles.filter((role) => role.id !== id);
    },
    nextRoleId(): string {
      const id = `role-mock-${roleSequence}`;
      roleSequence += 1;
      return id;
    },
  };
}
