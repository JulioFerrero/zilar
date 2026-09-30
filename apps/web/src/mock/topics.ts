import type { ChatSummary, TopicInfo, TopicKind, TopicStatus } from '@galena/chat-core';
import { atHour, plusMinutes } from './helpers';
import type { UiMessage } from '@galena/chat-core';
import { ME, PEOPLE } from './ids';

const ana = PEOPLE.ana!;
const luis = PEOPLE.luis!;
const marco = PEOPLE.marco!;
const dev1 = PEOPLE.dev1!;

interface TopicSeed {
  chatId: string;
  topicId: string;
  name: string;
  glyph: string;
  kind: TopicKind;
  status: TopicStatus;
  visibility: 'public' | 'private';
  isGeneral: boolean;
  owner: TopicInfo['owner'];
  linkUrl: string | null;
  linkLabel: string | null;
  unread: number;
  memberCount: number;
  at: Date;
  lastText: string;
  lastSender: { id: string; name: string };
}

// The "Dev team" group's topics from the mockup: General, the Safari
// checkout bug (in progress, owned by Dev-1), the pricing-page UI work,
// Daily standup, Release 2.4 notes, the private Hiring topic, and Ideas.
const TOPIC_SEEDS: TopicSeed[] = [
  {
    chatId: 'c-devteam',
    topicId: 't-devteam-general',
    name: 'General',
    glyph: 'G',
    kind: 'chat',
    status: 'open',
    visibility: 'public',
    isGeneral: true,
    owner: null,
    linkUrl: null,
    linkLabel: null,
    unread: 0,
    memberCount: 6,
    at: atHour(0, 10, 0),
    lastText: 'Thanks everyone.',
    lastSender: ME,
  },
  {
    chatId: 'c-devteam-bug',
    topicId: 't-devteam-bug',
    name: 'Checkout button hidden on Safari',
    glyph: 'B',
    kind: 'bug',
    status: 'in_progress',
    visibility: 'public',
    isGeneral: false,
    owner: { kind: 'ai', id: 'dev-1', name: 'Dev-1' },
    linkUrl: 'https://example.com/reviews/42',
    linkLabel: 'PR #42',
    unread: 3,
    memberCount: 6,
    at: atHour(0, 11, 2),
    lastText: 'Tests pass. Merge?',
    lastSender: dev1,
  },
  {
    chatId: 'c-devteam-ui',
    topicId: 't-devteam-ui',
    name: 'New pricing page',
    glyph: 'U',
    kind: 'ui',
    status: 'open',
    visibility: 'public',
    isGeneral: false,
    owner: { kind: 'user', id: 'u-ana', name: 'Ana' },
    linkUrl: 'https://example.com/pricing',
    linkLabel: null,
    unread: 0,
    memberCount: 6,
    at: atHour(0, 9, 0),
    lastText: 'Pushed a first draft of the pricing page.',
    lastSender: ana,
  },
  {
    chatId: 'c-devteam-standup',
    topicId: 't-devteam-standup',
    name: 'Daily standup',
    glyph: 'D',
    kind: 'routine',
    status: 'done',
    visibility: 'public',
    isGeneral: false,
    owner: null,
    linkUrl: null,
    linkLabel: null,
    unread: 0,
    memberCount: 6,
    at: atHour(1, 9, 30),
    lastText: 'Standup notes are in the wiki.',
    lastSender: luis,
  },
  {
    chatId: 'c-devteam-release',
    topicId: 't-devteam-release',
    name: 'Release 2.4 notes',
    glyph: 'R',
    kind: 'task',
    status: 'in_review',
    visibility: 'public',
    isGeneral: false,
    owner: { kind: 'user', id: 'u-luis', name: 'Luis' },
    linkUrl: null,
    linkLabel: null,
    unread: 0,
    memberCount: 6,
    at: atHour(1, 16, 0),
    lastText: 'Release notes drafted in docs/CHANGELOG.md.',
    lastSender: dev1,
  },
  {
    chatId: 'c-devteam-hiring',
    topicId: 't-devteam-hiring',
    name: 'Hiring: frontend role',
    glyph: 'H',
    kind: 'task',
    status: 'blocked',
    visibility: 'private',
    isGeneral: false,
    owner: { kind: 'user', id: 'u-ana', name: 'Ana' },
    linkUrl: null,
    linkLabel: null,
    unread: 0,
    memberCount: 2,
    at: atHour(0, 8, 0),
    lastText: 'Second round next Tuesday.',
    lastSender: ana,
  },
  {
    chatId: 'c-devteam-ideas',
    topicId: 't-devteam-ideas',
    name: 'Ideas',
    glyph: 'I',
    kind: 'chat',
    status: 'open',
    visibility: 'public',
    isGeneral: false,
    owner: null,
    linkUrl: null,
    linkLabel: null,
    unread: 0,
    memberCount: 6,
    at: atHour(2, 12, 0),
    lastText: 'What if the composer suggested replies?',
    lastSender: marco,
  },
];

function seedMessage(seed: TopicSeed): UiMessage {
  return {
    id: `mock-${seed.topicId}-last`,
    chatId: seed.chatId,
    senderId: seed.lastSender.id,
    senderName: seed.lastSender.name,
    text: seed.lastText,
    createdAt: seed.at,
    status: 'read',
  };
}

/** The mock topic chats for the "Dev team" group, newest message last. */
export function mockTopicChats(): ChatSummary[] {
  return TOPIC_SEEDS.map((seed) => ({
    id: seed.chatId,
    title: seed.name,
    kind: 'group',
    isAI: false,
    space: 'work',
    unread: seed.unread,
    muted: false,
    memberCount: seed.memberCount,
    onlineCount: 2,
    lastMessage: seedMessage(seed),
    groupId: 'g-devteam',
    groupTitle: 'Dev team',
    topic: {
      id: seed.topicId,
      glyph: seed.glyph,
      kind: seed.kind,
      status: seed.status,
      visibility: seed.visibility,
      isGeneral: seed.isGeneral,
      archived: false,
      owner: seed.owner,
      linkUrl: seed.linkUrl,
      linkLabel: seed.linkLabel,
    },
  }));
}

/** One mock message history per topic chat (a short thread each). */
export function mockTopicMessages(): Record<string, UiMessage[]> {
  const result: Record<string, UiMessage[]> = {};
  for (const seed of TOPIC_SEEDS) {
    const last = seedMessage(seed);
    result[seed.chatId] = [
      {
        id: `mock-${seed.topicId}-first`,
        chatId: seed.chatId,
        senderId: seed.lastSender.id,
        senderName: seed.lastSender.name,
        text: `Opening ${seed.name}.`,
        createdAt: plusMinutes(seed.at, -42),
        status: 'read',
      },
      last,
    ];
  }
  return result;
}

/** The mock topic members per topic id (private hiring: Ana + you). */
export function mockTopicMembersById(): Record<string, { userId: string; name: string }[]> {
  return {
    't-devteam-hiring': [
      { userId: 'u-you', name: 'You' },
      { userId: 'u-ana', name: 'Ana' },
    ],
  };
}

/** The mock AIs per topic id (the bug topic has Dev-1). */
export function mockTopicAisById(): Record<string, { id: string; name: string }[]> {
  return {
    't-devteam-bug': [{ id: 'dev-1', name: 'Dev-1' }],
  };
}
