import type { GroupDetail } from '@zilar/api-contract';
import type { MockSeed } from '../../data';
import type { MockData } from '../../state';
import type { MockGroup } from './tables';

function cloneGroup(group: GroupDetail): MockGroup {
  return {
    ...group,
    members: group.members.map((member) => ({
      ...member,
      ...(member.roles === undefined ? {} : { roles: member.roles.map((role) => ({ ...role })) }),
    })),
    ais: group.ais.map((entry) => ({ ...entry })),
    ...(group.background === undefined ? {} : { background: { ...group.background } }),
    ...(group.listener === undefined ? {} : { listener: { ...group.listener } }),
  };
}

/**
 * The groups table and its mutators. Rows are cloned from the seed, so a
 * caller-supplied seed is never changed; every array is replaced, never mutated
 * in place, so a `reset()` cannot leak a previous seed.
 */
export function createGroupsState(seed: MockSeed): Partial<MockData> {
  let groups: MockGroup[] = seed.groups.map(cloneGroup);
  let groupSequence = 1;
  return {
    get groups(): readonly MockGroup[] {
      return groups;
    },
    findGroup(id: string): MockGroup | undefined {
      return groups.find((group) => group.id === id);
    },
    putGroup(group: MockGroup): void {
      groups = groups.some((item) => item.id === group.id)
        ? groups.map((item) => (item.id === group.id ? group : item))
        : [...groups, group];
    },
    nextGroupId(): string {
      const id = `g-mock-${groupSequence}`;
      groupSequence += 1;
      return id;
    },
  };
}
