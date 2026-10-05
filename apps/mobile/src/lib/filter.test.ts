import { describe, expect, it } from 'vitest';

import { filterChats, inFolder, unreadCount } from './filter';
import type { ChatSummary } from './types';

function chat(id: string, overrides: Partial<ChatSummary>): ChatSummary {
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

const CHATS: ChatSummary[] = [
  chat('Ana', { unread: 2 }),
  chat('Dev AI', { isAI: true, kind: 'ai', space: 'work', unread: 1 }),
  chat('Dev team', { kind: 'group', space: 'work', unread: 3 }),
  chat('Viernes 🍻', { kind: 'group', unread: 0 }),
];

describe('inFolder', () => {
  it('splits humans, AIs and work', () => {
    expect(inFolder(CHATS[0], 'all')).toBe(true);
    expect(inFolder(CHATS[0], 'personal')).toBe(true);
    expect(inFolder(CHATS[0], 'ai')).toBe(false);
    expect(inFolder(CHATS[0], 'work')).toBe(false);
    expect(inFolder(CHATS[1], 'ai')).toBe(true);
    expect(inFolder(CHATS[1], 'work')).toBe(true);
    expect(inFolder(CHATS[1], 'personal')).toBe(false);
    expect(inFolder(CHATS[2], 'work')).toBe(true);
  });
});

describe('filterChats', () => {
  it('filters by folder', () => {
    expect(filterChats(CHATS, { folder: 'ai', search: '' }).map((item) => item.id)).toEqual([
      'Dev AI',
    ]);
    expect(filterChats(CHATS, { folder: 'personal', search: '' }).map((item) => item.id)).toEqual([
      'Ana',
      'Viernes 🍻',
    ]);
  });

  it('filters by title, ignoring case and surrounding spaces', () => {
    expect(filterChats(CHATS, { folder: 'all', search: '  dev ' }).map((item) => item.id)).toEqual([
      'Dev AI',
      'Dev team',
    ]);
    expect(filterChats(CHATS, { folder: 'all', search: 'nothing' })).toEqual([]);
  });

  it('combines folder and search', () => {
    expect(filterChats(CHATS, { folder: 'work', search: 'ai' }).map((item) => item.id)).toEqual([
      'Dev AI',
    ]);
  });
});

describe('unreadCount', () => {
  it('sums the unread messages of a folder', () => {
    expect(unreadCount(CHATS, 'all')).toBe(6);
    expect(unreadCount(CHATS, 'personal')).toBe(2);
    expect(unreadCount(CHATS, 'ai')).toBe(1);
    expect(unreadCount(CHATS, 'work')).toBe(4);
  });

  it('excludes muted chats from the totals', () => {
    const chats = [...CHATS, chat('Muted group', { kind: 'group', unread: 9, muted: true })];
    expect(unreadCount(chats, 'all')).toBe(6);
    expect(unreadCount(chats, 'personal')).toBe(2);
  });
});
