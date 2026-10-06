import { describe, expect, it } from 'vitest';
import type { ChatSummary } from '@zilar/chat-core';
import { createChatStore, groupChats, visibleChats } from './store';

function topicChat(id: string, title: string, isGeneral: boolean): ChatSummary {
  return {
    id,
    title,
    kind: 'group',
    isAI: false,
    space: 'work',
    unread: 0,
    muted: false,
    memberCount: 3,
    groupId: 'g-dev',
    groupTitle: 'Dev team',
    topic: {
      id,
      glyph: title[0] ?? 'G',
      kind: 'chat',
      status: 'open',
      visibility: 'public',
      isGeneral,
      archived: false,
      owner: null,
      linkUrl: null,
      linkLabel: null,
    },
  };
}

function dmChat(): ChatSummary {
  return {
    id: 'c-ana',
    title: 'Ana',
    kind: 'dm',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    memberCount: 2,
  };
}

function seed() {
  return createChatStore({
    chats: [topicChat('c-general', 'General', true), topicChat('c-bugs', 'Bugs', false), dmChat()],
  });
}

describe('chat list search matches group names', () => {
  it('dev returns the Dev team group with both topics', () => {
    const store = seed();
    store.getState().setSearch('dev');
    const groups = groupChats(store.getState());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe('Dev team');
    expect(groups[0]?.topics.map((topic) => topic.id).sort()).toEqual(['c-bugs', 'c-general']);
    expect(
      visibleChats(store.getState())
        .map((chat) => chat.id)
        .sort(),
    ).toEqual(['c-bugs', 'c-general']);
  });

  it('bug returns only the Bugs topic', () => {
    const store = seed();
    store.getState().setSearch('bug');
    const groups = groupChats(store.getState());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.topics.map((chat) => chat.id)).toEqual(['c-bugs']);
  });

  it('ana returns only the DM', () => {
    const store = seed();
    store.getState().setSearch('ana');
    const groups = groupChats(store.getState());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.topics.map((chat) => chat.id)).toEqual(['c-ana']);
    expect(visibleChats(store.getState()).map((chat) => chat.id)).toEqual(['c-ana']);
  });

  it('empty search returns everything', () => {
    const store = seed();
    store.getState().setSearch('');
    const groups = groupChats(store.getState());
    expect(groups).toHaveLength(2);
    expect(visibleChats(store.getState())).toHaveLength(3);
  });
});
