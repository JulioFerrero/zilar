// The topics domain's seed: the Dev team group's seven topics from web's
// `TOPIC_SEEDS` (`apps/web/src/mock/topics.ts`) and the mobile twin, keyed by
// the unified JIDs (`dev-team@rooms.zilar.test` for General, `ai-dev-1` for
// Dev-1). The private Hiring topic carries the Designers role; the pricing page
// names Designers as its approver, like both old mocks.
//
// Every other seeded group gets a General topic row of its own (T-1090), built
// by `generalTopicRow`, so `/groups/:id/topics` lists General for all of them,
// not only Dev team. It is the same row the real server creates on group create
// and keeps the group's room JID as its `chatJid`.
import type { MockSeed } from '../../data';
import { generalTopicRow, groupRoomJid } from '../chats/general-topics';
import { mockGroups } from '../groups/seed';
import type { MockTopic } from './tables';

const devTeamTopics: readonly MockTopic[] = [
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

/**
 * The seeded groups' General rows: one for every group the Dev team's seven
 * rows do not already cover, in the group's own room.
 */
const generalTopics: readonly MockTopic[] = mockGroups
  .filter((group) => !devTeamTopics.some((topic) => topic.groupId === group.id))
  .map((group) => generalTopicRow(group.id, groupRoomJid(group.id)));

/** Every live topic row: Dev team's seven plus one General per other group. */
export const mockTopics: readonly MockTopic[] = [...devTeamTopics, ...generalTopics];

/** The topics domain's rows for the combined seed. */
export function seedTopics(): Partial<MockSeed> {
  return { topics: mockTopics };
}
