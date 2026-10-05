import { describe, expect, it } from 'vitest';

import type { ChatSummary } from '@zilar/chat-core';

import { chatListModel } from './chat-list';

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

function at(time: string): ChatSummary['lastMessage'] {
  return {
    id: `m-${time}`,
    chatId: 'x',
    senderId: 'u-ana',
    senderName: 'Ana',
    text: time,
    createdAt: new Date(time),
    status: 'read',
  };
}

function topicChat(id: string, groupId: string, overrides: Partial<ChatSummary> = {}): ChatSummary {
  return chat(id, {
    kind: 'group',
    groupId,
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

describe('chatListModel', () => {
  it('orders pinned first, then by recency', () => {
    const model = chatListModel(
      [
        chat('fresh', { lastMessage: at('2026-09-30T12:00:00Z') }),
        chat('pinned', {
          lastMessage: at('2026-09-30T09:00:00Z'),
          pinnedAt: new Date('2026-09-30T10:00:00Z'),
        }),
        chat('older', { lastMessage: at('2026-09-30T11:00:00Z') }),
      ],
      { folder: undefined, search: '' },
    );
    expect(model.rows.map((row) => (row.kind === 'chat' ? row.chat.id : row.groupId))).toEqual([
      'pinned',
      'fresh',
      'older',
    ]);
    expect(model.archived).toEqual([]);
  });

  it('moves archived chats out of the rows into the Archived entry', () => {
    const model = chatListModel(
      [
        chat('fresh', { lastMessage: at('2026-09-30T12:00:00Z') }),
        chat('gone', { lastMessage: at('2026-09-30T12:30:00Z'), archived: true }),
      ],
      { folder: undefined, search: '' },
    );
    // The archived chat would be first by recency; it leaves the list.
    expect(model.rows.map((row) => (row.kind === 'chat' ? row.chat.id : row.groupId))).toEqual([
      'fresh',
    ]);
    expect(model.archived.map((entry) => entry.id)).toEqual(['gone']);
  });

  it('collapses a group with topics to one row, pinned when a topic is pinned', () => {
    const general = topicChat('general@g', 'g1', {
      lastMessage: at('2026-09-30T09:00:00Z'),
      topic: { ...topicChat('x', 'g1').topic!, isGeneral: true, id: 't-g' },
    });
    const bug = topicChat('bug@g', 'g1', {
      lastMessage: at('2026-09-30T08:00:00Z'),
      pinnedAt: new Date('2026-09-30T10:00:00Z'),
    });
    const model = chatListModel(
      [chat('fresh', { lastMessage: at('2026-09-30T12:00:00Z') }), general, bug],
      { folder: undefined, search: '' },
    );
    // The group floats first: one of its topics is pinned.
    expect(
      model.rows.map((row) => (row.kind === 'chat' ? row.chat.id : `group:${row.groupId}`)),
    ).toEqual(['group:g1', 'fresh']);
  });
});
