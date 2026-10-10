// The roles domain's seed: the Dev team group's two custom roles from web's
// `seedGroupRoles` (`apps/web/src/mock/api.ts`), Designers held by you and Ana,
// Devs by you and Luis.
import type { MockSeed } from '../../data';
import type { MockGroupRole } from './tables';

export const mockGroupRoles: readonly MockGroupRole[] = [
  {
    id: 'role-designers',
    groupId: 'g-devteam',
    name: 'Designers',
    memberIds: ['u-you', 'u-ana'],
  },
  { id: 'role-devs', groupId: 'g-devteam', name: 'Devs', memberIds: ['u-you', 'u-luis'] },
];

/** The roles domain's rows for the combined seed. */
export function seedRoles(): Partial<MockSeed> {
  return { groupRoles: mockGroupRoles };
}
