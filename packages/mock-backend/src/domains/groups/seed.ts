// The groups domain's seed: the mock groups and channels from web's
// `mockGroupDetails` (`apps/web/src/mock/groups.ts`), keyed by the group ids the
// `chats` seed already uses (`g-devteam` is `dev-team@rooms.zilar.test`).
// Member handles and custom roles match the group panel; AIs use the unified
// `@ai.zilar.test` JIDs of the `ais` domain.
import type { GroupAi, GroupDetail, GroupMember } from '@zilar/api-contract';
import type { MockSeed } from '../../data';

function member(
  userId: string,
  name: string,
  role: GroupMember['role'],
  roles: NonNullable<GroupMember['roles']> = [],
  handle?: string,
): GroupMember {
  return { userId, name, role, roles, ...(handle === undefined ? {} : { handle }) };
}

function ai(aiId: string, name: string, jid: string): GroupAi {
  return { aiId, jid, name, ownerId: 'u-you' };
}

/** Every seeded group, with the same members, roles and AIs as the web mock. */
export const mockGroups: readonly GroupDetail[] = [
  {
    id: 'g-devteam',
    title: 'Dev team',
    createdBy: 'u-you',
    membersCanCreateTopics: false,
    visibility: 'private',
    handle: null,
    members: [
      member(
        'u-you',
        'You',
        'owner',
        [
          { id: 'role-designers', name: 'Designers' },
          { id: 'role-devs', name: 'Devs' },
        ],
        'you',
      ),
      member('u-ana', 'Ana', 'admin', [{ id: 'role-designers', name: 'Designers' }], 'ana'),
      member('u-luis', 'Luis', 'member', [{ id: 'role-devs', name: 'Devs' }], 'luis'),
      member('u-marco', 'Marco', 'member', [], 'marco'),
    ],
    ais: [
      ai('ai-dev-1', 'Dev-1', 'dev-1@ai.zilar.test'),
      ai('ai-qa-1', 'QA-1', 'qa-1@ai.zilar.test'),
    ],
  },
  {
    id: 'g-viernes',
    title: 'Viernes 🍻',
    createdBy: 'u-luis',
    membersCanCreateTopics: false,
    visibility: 'private',
    handle: null,
    members: [
      member('u-luis', 'Luis', 'owner', [], 'luis'),
      member('u-you', 'You', 'member', [], 'you'),
      member('u-marta', 'Marta', 'member', [], 'marta'),
      member('u-ana', 'Ana', 'member', [], 'ana'),
      member('u-marco', 'Marco', 'member', [], 'marco'),
    ],
    ais: [],
  },
  {
    id: 'g-familia',
    title: 'Familia',
    createdBy: 'u-you',
    membersCanCreateTopics: false,
    visibility: 'private',
    handle: null,
    members: [
      member('u-you', 'You', 'owner', [], 'you'),
      member('u-sofia', 'Sofía', 'member', [], 'sofia'),
    ],
    ais: [],
  },
  {
    id: 'g-qa',
    title: 'QA squad',
    createdBy: 'u-luis',
    membersCanCreateTopics: false,
    visibility: 'private',
    handle: null,
    members: [member('u-luis', 'Luis', 'owner'), member('u-you', 'You', 'admin')],
    ais: [ai('ai-qa-1', 'QA-1', 'qa-1@ai.zilar.test')],
  },
  {
    id: 'g-gym',
    title: 'Gym buddies',
    createdBy: 'u-marco',
    membersCanCreateTopics: false,
    visibility: 'private',
    handle: null,
    members: [member('u-marco', 'Marco', 'owner'), member('u-you', 'You', 'member')],
    ais: [],
  },
  {
    id: 'g-product',
    title: 'Product',
    createdBy: 'u-you',
    membersCanCreateTopics: false,
    visibility: 'private',
    handle: null,
    members: [member('u-you', 'You', 'owner'), member('u-ana', 'Ana', 'member')],
    ais: [],
  },
  {
    id: 'g-acme',
    title: 'Acme Announcements',
    createdBy: 'u-you',
    membersCanCreateTopics: false,
    kind: 'channel',
    description: 'Release notes and team news.',
    visibility: 'public',
    handle: 'acme',
    members: [
      member('u-you', 'You', 'owner'),
      member('u-ana', 'Ana', 'admin'),
      member('u-luis', 'Luis', 'member'),
    ],
    ais: [],
  },
];

/** The groups domain's rows for the combined seed. */
export function seedGroups(): Partial<MockSeed> {
  return { groups: mockGroups };
}
