import { describe, expect, it } from 'vitest';

import type { ChatSummary } from './types';
import {
  groupRowFor,
  groupTopicChats,
  httpsTopicUrl,
  isLegacyGroupChat,
  isTopicChat,
  mayArchiveTopic,
  mayCreateTopic,
  mayManageTopic,
  summariesForTopicsEntry,
  sortTopics,
  topicInFolder,
  topicLinkText,
  topicOwnerLabel,
  topicStatusLabel,
  topicTypeLabel,
  topicsHeaderSubtitle,
  topicsOfGroup,
  TOPIC_GONE_NOTICE,
} from './topics';
import type { ChatEntry } from './chat-api';
import type { Topic } from './topics-api';

function topicWire(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 't-1',
    groupId: 'g1',
    name: 'Checkout bug',
    glyph: 'B',
    chatJid: 't-1@rooms.galena.test',
    visibility: 'public',
    kind: 'bug',
    status: 'in_progress',
    owner: { kind: 'ai', id: 'dev-1', name: 'Dev-1' },
    linkUrl: 'https://example.com/reviews/42',
    linkLabel: 'PR #42',
    isGeneral: false,
    archived: false,
    memberCount: 6,
    ais: [],
    roles: [],
    approverRole: null,
    ...overrides,
  };
}

function chat(id: string, overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id,
    title: id,
    kind: 'dm',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    ...overrides,
  };
}

function topicChat(id: string, overrides: Partial<ChatSummary> = {}): ChatSummary {
  return chat(id, {
    kind: 'group',
    groupId: 'g1',
    groupTitle: 'Dev team',
    topic: {
      id: `topic-${id}`,
      glyph: 'T',
      kind: 'chat',
      status: 'open',
      visibility: 'public',
      isGeneral: false,
      archived: false,
      owner: null,
      linkUrl: null,
      linkLabel: null,
    },
    ...overrides,
  });
}

describe('summariesForTopicsEntry', () => {
  it('maps each visible topic to its own chat keyed by room JID', () => {
    const entry: ChatEntry = {
      kind: 'group',
      chatJid: 'general@rooms.galena.test',
      title: 'Dev team',
      groupId: 'g1',
      memberCount: 6,
      role: 'member',
      topics: [
        {
          ...topicWire(),
          id: 't-general',
          name: 'General',
          isGeneral: true,
          chatJid: 'general@rooms.galena.test',
        },
        { ...topicWire(), id: 't-1', chatJid: 't-1@rooms.galena.test' },
      ],
    };
    const rows = summariesForTopicsEntry(entry);
    expect(rows.map((row) => row.id)).toEqual([
      'general@rooms.galena.test',
      't-1@rooms.galena.test',
    ]);
    expect(rows[0]?.groupId).toBe('g1');
    expect(rows[0]?.topic?.isGeneral).toBe(true);
    expect(rows[1]?.title).toBe('Checkout bug');
  });

  it('keeps one legacy row for an older server without topics', () => {
    const entry: ChatEntry = {
      kind: 'group',
      chatJid: 'team@rooms.galena.test',
      title: 'Team',
      groupId: 'g1',
      memberCount: 3,
      role: 'member',
    };
    const rows = summariesForTopicsEntry(entry);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('team@rooms.galena.test');
    expect(rows[0]?.topic).toBeUndefined();
    expect(isLegacyGroupChat(rows[0] as ChatSummary)).toBe(true);
  });

  it('excludes archived topics', () => {
    const entry: ChatEntry = {
      kind: 'group',
      chatJid: 'general@rooms.galena.test',
      title: 'Dev team',
      groupId: 'g1',
      memberCount: 6,
      role: 'member',
      topics: [{ ...topicWire(), archived: true }],
    };
    const rows = summariesForTopicsEntry(entry);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.topic).toBeUndefined();
  });

  it('marks topic chats', () => {
    expect(isTopicChat(topicChat('a'))).toBe(true);
    expect(isTopicChat(chat('b'))).toBe(false);
  });
});

describe('sortTopics', () => {
  it('puts General first, then newest first', () => {
    const general = topicChat('general', {
      title: 'General',
      topic: { ...topicChat('general').topic!, isGeneral: true, id: 't-general' },
      lastMessage: undefined,
    });
    const old = topicChat('old', {
      lastMessage: {
        id: 'm-old',
        chatId: 'old',
        senderId: 'u-ana',
        senderName: 'Ana',
        text: 'old',
        createdAt: new Date('2026-09-28T09:00:00Z'),
        status: 'read',
      },
    });
    const fresh = topicChat('fresh', {
      lastMessage: {
        id: 'm-fresh',
        chatId: 'fresh',
        senderId: 'u-ana',
        senderName: 'Ana',
        text: 'fresh',
        createdAt: new Date('2026-09-28T11:00:00Z'),
        status: 'read',
      },
    });
    expect(sortTopics([fresh, old, general]).map((row) => row.id)).toEqual([
      'general',
      'fresh',
      'old',
    ]);
  });
});

describe('topicsOfGroup and groupTopicChats', () => {
  it('collects one group topics sorted', () => {
    const chats = [topicChat('b'), topicChat('a'), chat('dm-1')];
    expect(topicsOfGroup(chats, 'g1').map((row) => row.id)).toEqual(['a', 'b']);
    const groups = groupTopicChats(chats);
    expect(groups.get('g1')?.map((row) => row.id)).toEqual(['b', 'a']);
    expect(groups.has('dm-1')).toBe(false);
  });
});

describe('groupRowFor', () => {
  it('aggregates unread, newest preview and counts', () => {
    const chats = [
      topicChat('general', {
        title: 'General',
        unread: 1,
        topic: { ...topicChat('general').topic!, isGeneral: true, id: 't-general' },
        lastMessage: {
          id: 'm-1',
          chatId: 'general',
          senderId: 'u-you',
          senderName: 'You',
          text: 'Thanks everyone.',
          createdAt: new Date('2026-09-28T10:00:00Z'),
          status: 'read',
        },
      }),
      topicChat('bug', {
        title: 'Checkout bug',
        unread: 3,
        lastMessage: {
          id: 'm-2',
          chatId: 'bug',
          senderId: 'dev-1',
          senderName: 'Dev-1',
          text: 'Tests pass. Merge?',
          createdAt: new Date('2026-09-28T11:02:00Z'),
          status: 'read',
        },
      }),
    ];
    const row = groupRowFor('g1', chats);
    expect(row?.title).toBe('Dev team');
    expect(row?.topicCount).toBe(2);
    expect(row?.unread).toBe(4);
    expect(row?.preview).toMatchObject({ senderName: 'Dev-1', text: 'Tests pass. Merge?' });
    expect(row?.topics.map((topic) => topic.id)).toEqual(['general', 'bug']);
  });

  it('returns undefined for an empty group', () => {
    expect(groupRowFor('g1', [])).toBeUndefined();
  });
});

describe('topicInFolder', () => {
  it('treats a topic like its group', () => {
    const topic = topicChat('bug', { space: 'work' });
    expect(topicInFolder(topic, 'work')).toBe(true);
    expect(topicInFolder(topic, 'personal')).toBe(false);
    expect(topicInFolder(topic, 'all')).toBe(true);
  });
});

describe('task strip labels', () => {
  it('labels types, statuses and owners', () => {
    const general = topicChat('general').topic!;
    expect(topicTypeLabel({ ...general, isGeneral: true, kind: 'chat' })).toBe('GENERAL');
    expect(topicTypeLabel({ ...general, isGeneral: false, kind: 'bug' })).toBe('BUG');
    expect(topicTypeLabel({ ...general, isGeneral: false, kind: 'routine' })).toBe('ROUTINE');
    expect(topicTypeLabel(undefined)).toBe('TOPIC');
    expect(topicStatusLabel('in_progress')).toBe('In progress');
    expect(topicStatusLabel('done')).toBe('Done');
    expect(topicOwnerLabel({ ...general, owner: null })).toBe('No owner');
    expect(topicOwnerLabel({ ...general, owner: { kind: 'user', id: 'u-ana', name: 'Ana' } })).toBe(
      'Owner: Ana',
    );
  });

  it('renders only https links', () => {
    expect(httpsTopicUrl('https://example.com/reviews/42')).toBe('https://example.com/reviews/42');
    expect(httpsTopicUrl('http://example.com/x')).toBeUndefined();
    expect(httpsTopicUrl('javascript:alert(1)')).toBeUndefined();
    expect(httpsTopicUrl(null)).toBeUndefined();
    expect(topicLinkText({ ...topicChat('a').topic!, linkLabel: 'PR #42' })).toBe('PR #42');
    expect(
      topicLinkText({
        ...topicChat('a').topic!,
        linkLabel: null,
        linkUrl: 'https://example.com/pricing',
      }),
    ).toBe('example.com');
    expect(topicLinkText({ ...topicChat('a').topic!, linkLabel: null, linkUrl: null })).toBe(
      'Add link',
    );
  });
});

describe('permissions', () => {
  const members = [
    { userId: 'u-you', name: 'You', role: 'owner' as const },
    { userId: 'u-ana', name: 'Ana', role: 'admin' as const },
    { userId: 'u-luis', name: 'Luis', role: 'member' as const },
  ];

  it('lets owners and admins create, members only when the switch is on', () => {
    expect(mayCreateTopic({ members, meUserId: 'u-you', membersCanCreateTopics: false })).toBe(
      true,
    );
    expect(mayCreateTopic({ members, meUserId: 'u-ana', membersCanCreateTopics: false })).toBe(
      true,
    );
    expect(mayCreateTopic({ members, meUserId: 'u-luis', membersCanCreateTopics: false })).toBe(
      false,
    );
    expect(mayCreateTopic({ members, meUserId: 'u-luis', membersCanCreateTopics: true })).toBe(
      true,
    );
    expect(mayCreateTopic({ members, meUserId: 'u-ghost', membersCanCreateTopics: true })).toBe(
      false,
    );
  });

  it('lets only managers manage and archive, never General', () => {
    const manager = { members, meUserId: 'u-ana', membersCanCreateTopics: false };
    const member = { members, meUserId: 'u-luis', membersCanCreateTopics: true };
    expect(mayManageTopic(manager)).toBe(true);
    expect(mayManageTopic(member)).toBe(false);
    expect(mayArchiveTopic(manager, topicChat('bug').topic)).toBe(true);
    expect(mayArchiveTopic(manager, { ...topicChat('general').topic!, isGeneral: true })).toBe(
      false,
    );
    expect(mayArchiveTopic(member, topicChat('bug').topic)).toBe(false);
  });
});

describe('header and notice', () => {
  it('formats the topics header subtitle', () => {
    expect(topicsHeaderSubtitle({ memberCount: 8, aiCount: 2, topicCount: 6 })).toBe(
      '8 members, 2 AIs, 6 topics',
    );
    expect(topicsHeaderSubtitle({ memberCount: 1, aiCount: 1, topicCount: 1 })).toBe(
      '1 member, 1 AI, 1 topic',
    );
  });

  it('never names the missing topic in the notice', () => {
    expect(TOPIC_GONE_NOTICE).toBe('This topic is no longer available.');
  });
});
