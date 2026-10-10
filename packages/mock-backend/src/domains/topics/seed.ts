// The topics domain's seed: the Dev team group's seven topics from web's
// `TOPIC_SEEDS` (`apps/web/src/mock/topics.ts`) and the mobile twin, keyed by
// the unified JIDs (`dev-team@rooms.zilar.test` for General, `ai-dev-1` for
// Dev-1). The private Hiring topic carries the Designers role; the pricing page
// names Designers as its approver, like both old mocks.
import type { Topic } from '@zilar/api-contract';
import type { MockSeed } from '../../data';
import { mockAis } from '../ais/seed';
import { mockGroups } from '../groups/seed';
import { mockGroupRoles } from '../roles/seed';
import { buildTopicView, type TopicViewSource } from './view';
import type { MockTopic } from './tables';

export const mockTopics: readonly MockTopic[] = [
  {
    id: 't-devteam-general',
    groupId: 'g-devteam',
    name: 'General',
    glyph: 'G',
    chatJid: 'dev-team@rooms.zilar.test',
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    owner: null,
    linkUrl: null,
    linkLabel: null,
    isGeneral: true,
    archived: false,
    memberIds: [],
    aiIds: [],
    roleIds: [],
    approverRoleId: null,
  },
  {
    id: 't-devteam-bug',
    groupId: 'g-devteam',
    name: 'Checkout button hidden on Safari',
    glyph: 'B',
    chatJid: 't-devteam-bug@rooms.zilar.test',
    visibility: 'public',
    kind: 'bug',
    status: 'in_progress',
    owner: { kind: 'ai', id: 'ai-dev-1', name: 'Dev-1' },
    linkUrl: 'https://example.com/reviews/42',
    linkLabel: 'PR #42',
    isGeneral: false,
    archived: false,
    memberIds: [],
    aiIds: ['ai-dev-1'],
    roleIds: [],
    approverRoleId: null,
  },
  {
    id: 't-devteam-ui',
    groupId: 'g-devteam',
    name: 'New pricing page',
    glyph: 'U',
    chatJid: 't-devteam-ui@rooms.zilar.test',
    visibility: 'public',
    kind: 'ui',
    status: 'open',
    owner: { kind: 'user', id: 'u-ana', name: 'Ana' },
    linkUrl: 'https://example.com/pricing',
    linkLabel: null,
    isGeneral: false,
    archived: false,
    memberIds: [],
    aiIds: [],
    roleIds: [],
    approverRoleId: 'role-designers',
  },
  {
    id: 't-devteam-standup',
    groupId: 'g-devteam',
    name: 'Daily standup',
    glyph: 'D',
    chatJid: 't-devteam-standup@rooms.zilar.test',
    visibility: 'public',
    kind: 'routine',
    status: 'done',
    owner: null,
    linkUrl: null,
    linkLabel: null,
    isGeneral: false,
    archived: false,
    memberIds: [],
    aiIds: [],
    roleIds: [],
    approverRoleId: null,
  },
  {
    id: 't-devteam-release',
    groupId: 'g-devteam',
    name: 'Release 2.4 notes',
    glyph: 'R',
    chatJid: 't-devteam-release@rooms.zilar.test',
    visibility: 'public',
    kind: 'task',
    status: 'in_review',
    owner: { kind: 'user', id: 'u-luis', name: 'Luis' },
    linkUrl: null,
    linkLabel: null,
    isGeneral: false,
    archived: false,
    memberIds: [],
    aiIds: [],
    roleIds: [],
    approverRoleId: null,
  },
  {
    id: 't-devteam-hiring',
    groupId: 'g-devteam',
    name: 'Hiring: frontend role',
    glyph: 'H',
    chatJid: 't-devteam-hiring@rooms.zilar.test',
    visibility: 'private',
    kind: 'task',
    status: 'blocked',
    owner: { kind: 'user', id: 'u-ana', name: 'Ana' },
    linkUrl: null,
    linkLabel: null,
    isGeneral: false,
    archived: false,
    memberIds: ['u-you', 'u-ana'],
    aiIds: [],
    roleIds: ['role-designers'],
    approverRoleId: null,
  },
  {
    id: 't-devteam-ideas',
    groupId: 'g-devteam',
    name: 'Ideas',
    glyph: 'I',
    chatJid: 't-devteam-ideas@rooms.zilar.test',
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    owner: null,
    linkUrl: null,
    linkLabel: null,
    isGeneral: false,
    archived: false,
    memberIds: [],
    aiIds: [],
    roleIds: [],
    approverRoleId: null,
  },
];

// The seed's own view source, built from the seed constants of the neighbouring
// domains (the routes use one built from the live `MockData` instead).
const SEED_SOURCE: TopicViewSource = {
  groupMemberCount: (groupId) =>
    mockGroups.find((group) => group.id === groupId)?.members.length ?? 0,
  role: (roleId) => {
    const role = mockGroupRoles.find((item) => item.id === roleId);
    return role === undefined
      ? undefined
      : { id: role.id, name: role.name, memberIds: role.memberIds };
  },
  aiName: (aiId) => mockAis.find((ai) => ai.id === aiId)?.name ?? 'An AI',
};

/**
 * The Dev team's visible topics as contract rows, for the `chats` seed's
 * `ChatEntry.topics`; the route rebuilds the same rows from the live tables.
 */
export function seedTopicViews(): Topic[] {
  return mockTopics
    .filter((topic) => !topic.archived)
    .sort((a, b) => (a.isGeneral === b.isGeneral ? 0 : a.isGeneral ? -1 : 1))
    .map((topic) => buildTopicView(topic, SEED_SOURCE));
}

/** The topics domain's rows for the combined seed. */
export function seedTopics(): Partial<MockSeed> {
  return { topics: mockTopics };
}
