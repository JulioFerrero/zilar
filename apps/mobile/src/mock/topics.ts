import type { ChatSummary } from '../lib/types';
import { at } from './time';

/**
 * The "Dev team" group's topics from the mockup (T-0112, the same seven as
 * the web mock in `apps/web/src/mock/topics.ts`): General, the Safari
 * checkout bug (in progress, owned by Dev AI), the pricing-page UI work,
 * Daily standup, Release 2.4 notes, the private Hiring topic, and Ideas.
 * General keeps the group's old chat id (`dev-team`), so old deep links open
 * it; every other topic gets its own chat id.
 */

interface TopicSeed {
  chatId: string;
  topicId: string;
  name: string;
  glyph: string;
  kind: 'chat' | 'task' | 'bug' | 'ui' | 'routine';
  status: 'open' | 'in_progress' | 'in_review' | 'blocked' | 'done';
  visibility: 'public' | 'private';
  isGeneral: boolean;
  owner: { kind: 'user' | 'ai'; id: string; name: string } | null;
  linkUrl: string | null;
  linkLabel: string | null;
  unread: number;
  memberCount: number;
  daysAgo: number;
  hour: number;
  minute: number;
  lastText: string;
  lastSenderId: string;
  lastSenderName: string;
}

const TOPIC_SEEDS: TopicSeed[] = [
  {
    chatId: 'dev-team',
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
    daysAgo: 0,
    hour: 10,
    minute: 0,
    lastText: 'Thanks everyone.',
    lastSenderId: 'me',
    lastSenderName: 'You',
  },
  {
    chatId: 't-devteam-bug',
    topicId: 't-devteam-bug',
    name: 'Checkout button hidden on Safari',
    glyph: 'B',
    kind: 'bug',
    status: 'in_progress',
    visibility: 'public',
    isGeneral: false,
    owner: { kind: 'ai', id: 'dev-ai', name: 'Dev AI' },
    linkUrl: 'https://example.com/reviews/42',
    linkLabel: 'PR #42',
    unread: 3,
    memberCount: 6,
    daysAgo: 0,
    hour: 11,
    minute: 2,
    lastText: 'Tests pass. Merge?',
    lastSenderId: 'dev-ai',
    lastSenderName: 'Dev AI',
  },
  {
    chatId: 't-devteam-ui',
    topicId: 't-devteam-ui',
    name: 'New pricing page',
    glyph: 'U',
    kind: 'ui',
    status: 'open',
    visibility: 'public',
    isGeneral: false,
    owner: { kind: 'user', id: 'ana', name: 'Ana' },
    linkUrl: 'https://example.com/pricing',
    linkLabel: null,
    unread: 0,
    memberCount: 6,
    daysAgo: 0,
    hour: 9,
    minute: 0,
    lastText: 'Pushed a first draft of the pricing page.',
    lastSenderId: 'ana',
    lastSenderName: 'Ana',
  },
  {
    chatId: 't-devteam-standup',
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
    daysAgo: 1,
    hour: 9,
    minute: 30,
    lastText: 'Standup notes are in the wiki.',
    lastSenderId: 'luis',
    lastSenderName: 'Luis',
  },
  {
    chatId: 't-devteam-release',
    topicId: 't-devteam-release',
    name: 'Release 2.4 notes',
    glyph: 'R',
    kind: 'task',
    status: 'in_review',
    visibility: 'public',
    isGeneral: false,
    owner: { kind: 'user', id: 'luis', name: 'Luis' },
    linkUrl: null,
    linkLabel: null,
    unread: 0,
    memberCount: 6,
    daysAgo: 1,
    hour: 16,
    minute: 0,
    lastText: 'Release notes drafted in docs/CHANGELOG.md.',
    lastSenderId: 'dev-ai',
    lastSenderName: 'Dev AI',
  },
  {
    chatId: 't-devteam-hiring',
    topicId: 't-devteam-hiring',
    name: 'Hiring: frontend role',
    glyph: 'H',
    kind: 'task',
    status: 'blocked',
    visibility: 'private',
    isGeneral: false,
    owner: { kind: 'user', id: 'ana', name: 'Ana' },
    linkUrl: null,
    linkLabel: null,
    unread: 0,
    memberCount: 2,
    daysAgo: 0,
    hour: 8,
    minute: 0,
    lastText: 'Second round next Tuesday.',
    lastSenderId: 'ana',
    lastSenderName: 'Ana',
  },
  {
    chatId: 't-devteam-ideas',
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
    daysAgo: 2,
    hour: 12,
    minute: 0,
    lastText: 'What if the composer suggested replies?',
    lastSenderId: 'marta',
    lastSenderName: 'Marta',
  },
];

/** The mock topic chats for the "Dev team" group. */
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
    lastMessage: {
      id: `mock-${seed.topicId}-last`,
      chatId: seed.chatId,
      senderId: seed.lastSenderId,
      senderName: seed.lastSenderName,
      text: seed.lastText,
      createdAt: at(seed.daysAgo, seed.hour, seed.minute),
      status: 'read',
    },
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

/** The mock members and AIs per topic id (private hiring: Ana + you). */
export function mockTopicMembersById(): Record<string, { userId: string; name: string }[]> {
  return {
    't-devteam-hiring': [
      { userId: 'me', name: 'You' },
      { userId: 'ana', name: 'Ana' },
    ],
  };
}

/** The mock group detail for the Dev team topics (people + AIs + the switch). */
export function mockDevteamGroupDetail(): {
  id: string;
  title: string;
  createdBy: string;
  membersCanCreateTopics: boolean;
  members: {
    userId: string;
    name: string;
    role: 'owner' | 'admin' | 'member';
    roles: { id: string; name: string }[];
  }[];
  ais: { aiId: string; jid: string; name: string; ownerId: string }[];
} {
  return {
    id: 'g-devteam',
    title: 'Dev team',
    createdBy: 'me',
    membersCanCreateTopics: false,
    members: [
      {
        userId: 'me',
        name: 'You',
        role: 'owner',
        roles: [
          { id: 'role-designers', name: 'Designers' },
          { id: 'role-devs', name: 'Devs' },
        ],
      },
      {
        userId: 'ana',
        name: 'Ana',
        role: 'admin',
        roles: [{ id: 'role-designers', name: 'Designers' }],
      },
      {
        userId: 'luis',
        name: 'Luis',
        role: 'member',
        roles: [{ id: 'role-devs', name: 'Devs' }],
      },
      { userId: 'marta', name: 'Marta', role: 'member', roles: [] },
    ],
    ais: [
      { aiId: 'dev-ai', jid: 'ai-dev-ai@zilar.test', name: 'Dev AI', ownerId: 'me' },
      {
        aiId: 'marketing-ai',
        jid: 'ai-marketing-ai@zilar.test',
        name: 'Marketing AI',
        ownerId: 'me',
      },
    ],
  };
}

/** The mock AIs in one topic by topic id (the bug topic has Dev AI). */
export function mockTopicAisById(): Record<string, { id: string; name: string }[]> {
  return {
    't-devteam-bug': [{ id: 'dev-ai', name: 'Dev AI' }],
  };
}

/** The mock AIs the viewer owns that are in the Dev team group. */
export function mockDevteamOwnedAis(): { id: string; name: string }[] {
  return [
    { id: 'dev-ai', name: 'Dev AI' },
    { id: 'marketing-ai', name: 'Marketing AI' },
  ];
}

/**
 * The Dev team group's custom roles (T-0137, the same two as the web mock):
 * Designers held by you and Ana, Devs by you and Luis.
 */
export function mockGroupRoles(): {
  id: string;
  name: string;
  members: { userId: string; name: string }[];
}[] {
  return [
    {
      id: 'role-designers',
      name: 'Designers',
      members: [
        { userId: 'me', name: 'You' },
        { userId: 'ana', name: 'Ana' },
      ],
    },
    {
      id: 'role-devs',
      name: 'Devs',
      members: [
        { userId: 'me', name: 'You' },
        { userId: 'luis', name: 'Luis' },
      ],
    },
  ];
}

/** The display name of a Dev team member, falling back to the id. */
export function mockMemberName(userId: string): string {
  return (
    mockDevteamGroupDetail().members.find((member) => member.userId === userId)?.name ?? userId
  );
}

/**
 * The roles attached to each mock topic (T-0137, mirroring the web mock):
 * the private hiring topic carries Designers, the pricing-page UI topic
 * names Designers as its approver.
 */
export function mockTopicRolesById(): Record<
  string,
  {
    roles: { id: string; name: string; memberCount: number }[];
    approverRole: { id: string; name: string } | null;
  }
> {
  const roles = mockGroupRoles();
  const view = (id: string): { id: string; name: string; memberCount: number } => {
    const role = roles.find((entry) => entry.id === id);
    return { id, name: role?.name ?? id, memberCount: role?.members.length ?? 0 };
  };
  return {
    't-devteam-hiring': {
      roles: [view('role-designers')],
      approverRole: null,
    },
    't-devteam-ui': {
      roles: [],
      approverRole: { id: 'role-designers', name: 'Designers' },
    },
  };
}

/** The topic roles of one mock topic id, or none for topics without any. */
export function mockTopicRolesOf(topicId: string): {
  roles: { id: string; name: string; memberCount: number }[];
  approverRole: { id: string; name: string } | null;
} {
  return mockTopicRolesById()[topicId] ?? { roles: [], approverRole: null };
}
